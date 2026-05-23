# Minecraft Plugin Compiler v2.0

Multi-page online Minecraft Plugin Compiler with build history.

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | Landing page with stats & features |
| Compiler | `/compiler` | Upload & compile plugins |
| Detail | `/detail/:id` | Build logs & download |

## Deploy on Railway

```bash
# 1. Extract ZIP
unzip minecraft-plugin-compiler-v2.zip

# 2. Deploy
cd minecraft-plugin-compiler
railway login
railway init
railway up
```

## API Endpoints

- `POST /compile` - Upload & compile
- `GET /api/history` - Get all builds
- `GET /api/build/:id` - Get single build
- `GET /api/stats` - Get statistics
- `GET /download/:id/:filename` - Download JAR