import * as d from '../declarations';
import * as fs from './screenshot-fs';
import * as path from 'path';
import { URL } from 'url';
import { normalizePath } from '../compiler/util';


export class ScreenshotConnector implements d.ScreenshotConnector {
  screenshotDirName = 'screenshot';
  masterDirName = 'master';
  localDirName = 'local';
  compareAppFileName = 'compare.html';
  imagesDirName = 'images';
  logger: d.Logger;
  buildId: string;
  buildMessage: string;
  rootDir: string;
  cacheDir: string;
  compareAppDir: string;
  screenshotDir: string;
  masterDir: string;
  localDir: string;
  imagesDir: string;
  updateMaster: boolean;
  compareUrl: string;
  masterBuild: d.ScreenshotBuild;
  localBuild: d.ScreenshotBuild;
  allowableMismatchedRatio: number;
  allowableMismatchedPixels: number;
  pixelmatchThreshold: number;

  async initBuild(opts: d.ScreenshotConnectorOptions) {
    this.logger = opts.logger;

    this.buildId = opts.buildId;
    this.buildMessage = opts.buildMessage;
    this.cacheDir = opts.cacheDir;
    this.rootDir = opts.rootDir;
    this.compareAppDir = opts.compareAppDir;
    this.updateMaster = !!opts.updateMaster;
    this.allowableMismatchedPixels = opts.allowableMismatchedPixels;
    this.allowableMismatchedRatio = opts.allowableMismatchedRatio;
    this.pixelmatchThreshold = opts.pixelmatchThreshold;

    this.logger.debug(`screenshot build: ${this.buildId}, ${this.buildMessage}, updateMaster: ${this.updateMaster}`);
    this.logger.debug(`screenshot, allowableMismatchedPixels: ${this.allowableMismatchedPixels}, allowableMismatchedRatio: ${this.allowableMismatchedRatio}, pixelmatchThreshold: ${this.pixelmatchThreshold}`);

    if (typeof opts.screenshotDirName === 'string') {
      this.screenshotDirName = opts.screenshotDirName;
    }

    if (typeof opts.masterDirName === 'string') {
      this.masterDirName = opts.masterDirName;
    }

    if (typeof opts.localDirName === 'string') {
      this.localDirName = opts.localDirName;
    }

    if (typeof opts.compareAppFileName === 'string') {
      this.compareAppFileName = opts.compareAppFileName;
    }

    if (typeof opts.imagesDirName === 'string') {
      this.imagesDirName = opts.imagesDirName;
    }

    this.screenshotDir = path.join(this.rootDir, this.screenshotDirName);
    this.imagesDir = path.join(this.screenshotDir, this.imagesDirName);
    this.masterDir = path.join(this.screenshotDir, this.masterDirName);
    this.localDir = path.join(this.screenshotDir, this.localDirName);

    this.logger.debug(`screenshotDirPath: ${this.screenshotDir}`);
    this.logger.debug(`imagesDirPath: ${this.imagesDir}`);
    this.logger.debug(`masterDirPath: ${this.masterDir}`);
    this.logger.debug(`localDirPath: ${this.localDir}`);

    await fs.mkDir(this.screenshotDir);

    await Promise.all([
      fs.mkDir(this.imagesDir),
      fs.mkDir(this.masterDir),
      fs.mkDir(this.localDir)
    ]);

    const fsTasks: Promise<any>[] = [];

    if (this.updateMaster) {
      this.logger.debug(`empty master: ${this.masterDir}`);
      fsTasks.push(fs.emptyDir(this.masterDir));
    } else {
      await this.pullMasterImages();
    }

    fsTasks.push(fs.emptyDir(this.localDir));

    const gitIgnorePath = path.join(this.screenshotDir, '.gitignore');
    const gitIgnoreExists = await fs.fileExists(gitIgnorePath);
    if (!gitIgnoreExists) {
      const content: string[] = [];

      if (opts.gitIgnoreImages !== false) {
        content.push(this.imagesDirName);
      }
      if (opts.gitIgnoreLocal !== false) {
        content.push(this.localDirName);
      }
      if (opts.gitIgnoreCompareApp !== false) {
        content.push(this.compareAppFileName);
      }

      if (content.length) {
        content.unshift(`# only master screenshot data should be committed`);
        fsTasks.push(fs.writeFile(gitIgnorePath, content.join('\n')));
      }
    }

    const compareAppFilePath = path.join(this.screenshotDir, this.compareAppFileName);
    const url = new URL(`file://${compareAppFilePath}`);
    this.compareUrl = url.href;

    this.logger.debug(`compareUrl: ${this.compareUrl}`);

    await Promise.all(fsTasks);
  }

  async pullMasterImages() {/**/}

  async completeBuild() {
    const masterFilePaths = (await fs.readDir(this.masterDir)).map(f => path.join(this.masterDir, f)).filter(f => f.endsWith('.json'));
    const masterScreenshots = await Promise.all(masterFilePaths.map(async f => JSON.parse(await fs.readFile(f)) as d.ScreenshotData));

    sortScreenshots(masterScreenshots);

    this.masterBuild = {
      id: 'master',
      message: 'Master',
      screenshots: masterScreenshots
    };

    const localFilePaths = (await fs.readDir(this.localDir)).map(f => path.join(this.localDir, f)).filter(f => f.endsWith('.json'));
    const localScreenshots = await Promise.all(localFilePaths.map(async f => JSON.parse(await fs.readFile(f)) as d.ScreenshotData));

    sortScreenshots(localScreenshots);

    this.localBuild = {
      id: this.buildId,
      message: this.buildMessage,
      screenshots: localScreenshots
    };

    await fs.emptyDir(this.localDir);

    const localBuildPath = path.join(this.localDir, `${this.localBuild.id}.json`);

    await fs.writeFile(localBuildPath, JSON.stringify(this.localBuild, null, 2));

    for (let i = 0; i < localScreenshots.length; i++) {
      const screenshot = localScreenshots[i];
      const imageName = screenshot.image;
      const jsonpFileName = `screenshot_${imageName}.js`;
      const jsonFilePath = path.join(this.cacheDir, jsonpFileName);
      const jsonpExists = await fs.fileExists(jsonFilePath);
      if (jsonpExists) {
        continue;
      }

      const imageFilePath = path.join(this.imagesDir, imageName);
      const imageBuf = await fs.readFileBuffer(imageFilePath);
      const jsonpContent = `loadScreenshot("${imageName}","data:image/png;base64,${imageBuf.toString('base64')}",${screenshot.width},${screenshot.height},${screenshot.deviceScaleFactor},${screenshot.naturalWidth},${screenshot.naturalHeight});`;
      await fs.writeFile(jsonFilePath, jsonpContent);
    }
  }

  async publishBuild() {
    const appUrl = normalizePath(path.relative(this.screenshotDir, this.compareAppDir));
    const imagesUrl = normalizePath(path.relative(this.screenshotDir, this.imagesDir));
    const jsonpUrl = normalizePath(path.relative(this.screenshotDir, this.cacheDir));

    const html = createLocalCompare(appUrl, imagesUrl, jsonpUrl, this.masterBuild, this.localBuild);

    const compareAppPath = path.join(this.screenshotDir, this.compareAppFileName);
    await fs.writeFile(compareAppPath, html);
  }

  getComparisonSummaryUrl() {
    return this.compareUrl;
  }

  getTotalScreenshotImages() {
    return this.localBuild.screenshots.length;
  }

  toJson() {
    const screenshotBuild: d.ScreenshotBuildData = {
      id: this.buildId,
      rootDir: this.rootDir,
      cacheDir: this.cacheDir,
      screenshotDirPath: this.screenshotDir,
      imagesDirPath: this.imagesDir,
      masterDirPath: this.masterDir,
      localDirPath: this.localDir,
      updateMaster: this.updateMaster,
      compareUrlTemplate: this.compareUrl,
      allowableMismatchedPixels: this.allowableMismatchedPixels,
      allowableMismatchedRatio: this.allowableMismatchedRatio,
      pixelmatchThreshold: this.pixelmatchThreshold
    };

    return JSON.stringify(screenshotBuild);
  }

}


function createLocalCompare(appUrl: string, imagesUrl: string, jsonpUrl: string, masterBuild: d.ScreenshotBuild, localBuild: d.ScreenshotBuild) {
  return `<!DOCTYPE html>
<html dir="ltr" lang="en">
<head>
  <meta charset="utf-8">
  <title>Stencil Screenshot Comparison</title>
  <meta name="viewport" content="viewport-fit=cover, width=device-width, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta http-equiv="x-ua-compatible" content="IE=Edge">
  <link href="${appUrl}/build/app.css" rel="stylesheet">
  <script src="${appUrl}/build/app.js"></script>
  <link rel="icon" type="image/x-icon" href="${appUrl}/assets/favicon.ico">
</head>
<body>
  <ion-app></ion-app>
  <script>
    (function() {
      var compare = document.createElement('local-compare');
      compare.imagesUrl = '${imagesUrl}/';
      compare.jsonpUrl = '${jsonpUrl}/';
      compare.buildA = ${JSON.stringify(masterBuild)};
      compare.buildB = ${JSON.stringify(localBuild)};
      compare.className = 'ion-page';
      document.querySelector('ion-app').appendChild(compare);
    })();
  </script>
</body>
</html>`;
}


function sortScreenshots(screenshots: d.ScreenshotData[]) {
  screenshots.sort((a, b) => {
    if (a.desc && b.desc) {
      if (a.desc.toLowerCase() < b.desc.toLowerCase()) return -1;
      if (a.desc.toLowerCase() > b.desc.toLowerCase()) return 1;
    }

    if (a.device && b.device) {
      if (a.device.toLowerCase() < b.device.toLowerCase()) return -1;
      if (a.device.toLowerCase() > b.device.toLowerCase()) return 1;
    }

    if (a.userAgent && b.userAgent) {
      if (a.userAgent.toLowerCase() < b.userAgent.toLowerCase()) return -1;
      if (a.userAgent.toLowerCase() > b.userAgent.toLowerCase()) return 1;
    }

    if (a.width < b.width) return -1;
    if (a.width > b.width) return 1;

    if (a.height < b.height) return -1;
    if (a.height > b.height) return 1;

    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;

    return 0;
  });
}
