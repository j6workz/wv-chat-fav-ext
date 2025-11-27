#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Read version from manifest.json
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')
DIST_DIR="dist"
ZIP_NAME="workvivo-chat-favorites-v${VERSION}.zip"

echo -e "${YELLOW}Building WorkVivo Chat Favorites v${VERSION}${NC}"

# Check secrets.js exists
if [ ! -f "secrets.js" ]; then
    echo -e "${RED}Error: secrets.js not found!${NC}"
    echo "Copy secrets.example.js to secrets.js and add your OAuth credentials"
    exit 1
fi

# Clean previous build
rm -rf "$DIST_DIR"
rm -f "$ZIP_NAME"
mkdir -p "$DIST_DIR"

echo "Copying files..."

# Core files
cp manifest.json "$DIST_DIR/"
cp background.js "$DIST_DIR/"
cp secrets.js "$DIST_DIR/"
cp content.js "$DIST_DIR/"
cp styles.css "$DIST_DIR/"

# Inject scripts
cp inject-early.js "$DIST_DIR/"
cp inject-fetch-interceptor.js "$DIST_DIR/"
cp inject-websocket-interceptor.js "$DIST_DIR/"
cp inject-xhr-interceptor.js "$DIST_DIR/"
cp page-script.js "$DIST_DIR/"

# HTML pages and their JS
cp popup.html popup.js "$DIST_DIR/"
cp options.html options.js "$DIST_DIR/"
cp welcome.html welcome.js "$DIST_DIR/"

# Assets (icons folder)
cp -r icons "$DIST_DIR/"

# Modules (entire folder)
cp -r modules "$DIST_DIR/"

# Remove any .DS_Store files
find "$DIST_DIR" -name '.DS_Store' -delete

# Create zip
echo "Creating zip..."
cd "$DIST_DIR"
zip -rq "../$ZIP_NAME" .
cd ..

# Cleanup dist folder
rm -rf "$DIST_DIR"

# Output result
echo -e "${GREEN}Built: $ZIP_NAME${NC}"
echo "Size: $(du -h "$ZIP_NAME" | cut -f1)"
echo "Files: $(unzip -l "$ZIP_NAME" | tail -1 | awk '{print $2}')"
