FROM node:18-slim

# Install Java, Gradle, Maven, and unzip
RUN apt-get update &&     apt-get install -y     openjdk-17-jdk     gradle     maven     unzip     && apt-get clean     && rm -rf /var/lib/apt/lists/*

# Set Java environment
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# Verify installations
RUN java -version && gradle -v && mvn -v

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app files
COPY . .

# Create necessary directories
RUN mkdir -p uploads downloads history

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "start"]