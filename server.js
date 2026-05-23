const express = require('express');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DOWNLOAD_DIR = path.join(UPLOAD_DIR, 'downloads');
const HISTORY_DIR = path.join(__dirname, 'history');

[UPLOAD_DIR, DOWNLOAD_DIR, HISTORY_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Store build history in memory + file
let buildHistory = [];
const HISTORY_FILE = path.join(HISTORY_DIR, 'builds.json');

// Load existing history
if (fs.existsSync(HISTORY_FILE)) {
    try {
        buildHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    } catch(e) {
        buildHistory = [];
    }
}

function saveHistory() {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(buildHistory, null, 2));
}

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ========== COMPILATION FUNCTION ==========
async function compilePlugin(zipPath, buildId) {
    const extractDir = path.join(UPLOAD_DIR, 'extracted-' + buildId);

    try {
        // 1. Extract ZIP
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);

        // 2. Find project root (may be nested)
        let projectRoot = extractDir;
        const files = fs.readdirSync(extractDir);

        if (files.length === 1 && fs.statSync(path.join(extractDir, files[0])).isDirectory()) {
            projectRoot = path.join(extractDir, files[0]);
        }

        // 3. Check build system
        const hasGradle = fs.existsSync(path.join(projectRoot, 'build.gradle'));
        const hasMaven = fs.existsSync(path.join(projectRoot, 'pom.xml'));

        if (!hasGradle && !hasMaven) {
            throw new Error('No build.gradle or pom.xml found! Make sure your ZIP has proper project structure.');
        }

        let command, buildOutputPath, buildType;

        if (hasGradle) {
            const gradlewPath = path.join(projectRoot, 'gradlew');
            if (fs.existsSync(gradlewPath)) {
                fs.chmodSync(gradlewPath, 0o755);
            }
            const gradleCmd = fs.existsSync(gradlewPath) ? './gradlew' : 'gradle';
            command = `${gradleCmd} build`;
            buildOutputPath = path.join(projectRoot, 'build', 'libs');
            buildType = 'Gradle';
        } else {
            command = 'mvn clean package';
            buildOutputPath = path.join(projectRoot, 'target');
            buildType = 'Maven';
        }

        // 4. Run build
        const startTime = Date.now();
        const output = execSync(command, {
            cwd: projectRoot,
            encoding: 'utf8',
            timeout: 300000,
            env: {
                ...process.env,
                JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64'
            }
        });
        const buildTime = Date.now() - startTime;

        // 5. Find built JAR file
        if (!fs.existsSync(buildOutputPath)) {
            throw new Error('Build completed but output directory not found!');
        }

        const jars = fs.readdirSync(buildOutputPath)
            .filter(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('javadoc'))
            .map(f => path.join(buildOutputPath, f));

        if (jars.length === 0) {
            throw new Error('No JAR file found after build!');
        }

        const mainJar = jars.reduce((a, b) => 
            fs.statSync(a).size > fs.statSync(b).size ? a : b
        );

        // Copy to downloads
        const jarName = path.basename(mainJar);
        const finalPath = path.join(DOWNLOAD_DIR, buildId + '-' + jarName);
        fs.copyFileSync(mainJar, finalPath);

        // Cleanup
        fs.rmSync(extractDir, { recursive: true, force: true });
        fs.unlinkSync(zipPath);

        return {
            success: true,
            jarPath: finalPath,
            jarName: jarName,
            output: output,
            buildType: buildType,
            buildTime: buildTime
        };

    } catch (error) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        return {
            success: false,
            error: error.stdout || error.stderr || error.message,
            buildType: hasGradle ? 'Gradle' : (hasMaven ? 'Maven' : 'Unknown')
        };
    }
}

// ========== ROUTES ==========

// Pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/compiler', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'compiler.html'));
});

app.get('/detail/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'detail.html'));
});

// API: Get build history
app.get('/api/history', (req, res) => {
    res.json({
        success: true,
        history: buildHistory.slice().reverse()
    });
});

// API: Get single build detail
app.get('/api/build/:id', (req, res) => {
    const build = buildHistory.find(b => b.id === req.params.id);
    if (!build) {
        return res.status(404).json({ success: false, error: 'Build not found!' });
    }
    res.json({ success: true, build });
});

// Upload & Compile
app.post('/compile', upload.single('plugin'), async (req, res) => {
    if (!req.file) {
        return res.json({ success: false, error: 'No file uploaded!' });
    }

    const buildId = uuidv4();
    const zipPath = req.file.path;
    const originalName = req.file.originalname;

    try {
        const result = await compilePlugin(zipPath, buildId);

        const buildRecord = {
            id: buildId,
            filename: originalName,
            timestamp: new Date().toISOString(),
            status: result.success ? 'success' : 'failed',
            buildType: result.buildType || 'Unknown',
            buildTime: result.buildTime || 0,
            jarName: result.jarName || null,
            downloadUrl: result.success ? `/download/${buildId}/${result.jarName}` : null,
            error: result.success ? null : result.error,
            logs: result.output || result.error || ''
        };

        buildHistory.push(buildRecord);
        saveHistory();

        if (result.success) {
            res.json({
                success: true,
                buildId: buildId,
                message: 'Compilation successful!',
                downloadUrl: buildRecord.downloadUrl,
                detailUrl: `/detail/${buildId}`,
                buildOutput: result.output
            });
        } else {
            res.json({
                success: false,
                buildId: buildId,
                error: result.error,
                detailUrl: `/detail/${buildId}`
            });
        }

    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Download compiled JAR
app.get('/download/:id/:filename', (req, res) => {
    const filePath = path.join(DOWNLOAD_DIR, req.params.id + '-' + req.params.filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found!' });
    }

    res.download(filePath, req.params.filename, (err) => {
        if (!err) {
            setTimeout(() => {
                try { fs.unlinkSync(filePath); } catch(e) {}
            }, 60000);
        }
    });
});

// API: Stats
app.get('/api/stats', (req, res) => {
    const total = buildHistory.length;
    const successful = buildHistory.filter(b => b.status === 'success').length;
    const failed = total - successful;

    res.json({
        success: true,
        stats: { total, successful, failed }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});