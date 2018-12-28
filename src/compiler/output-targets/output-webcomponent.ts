import * as d from '../../declarations';
import { generateAppCore } from '../app-core/generate-app-core';
import { getBuildFeatures, updateBuildConditionals } from '../app-core/build-conditionals';
import { MIN_FOR_LAZY_LOAD } from './output-lazy-load';
import { pathJoin } from '../util';
import { DEFAULT_STYLE_MODE } from '../../util/constants';
import { replaceStylePlaceholders } from 'app-core/register-styles';


export async function generateWebComponents(config: d.Config, compilerCtx: d.CompilerCtx, buildCtx: d.BuildCtx, stylesPromise: Promise<void>) {
  if (!buildCtx.requiresFullBuild && buildCtx.isRebuild && !buildCtx.hasScriptChanges) {
    return;
  }

  const selfContainedOutputTargets = (config.outputTargets as d.OutputTargetWebComponent[]).filter(o => {
    return (o.type === 'webcomponent');
  });

  const bundledOutputTargets = (config.outputTargets as d.OutputTargetBuild[]).filter(o => {
    if (o.type === 'www' || o.type === 'dist') {
      if (buildCtx.moduleFiles.length < MIN_FOR_LAZY_LOAD) {
        return true;
      }
    }
    return false;
  });

  if (selfContainedOutputTargets.length === 0 && bundledOutputTargets.length === 0) {
    return;
  }

  await stylesPromise;

  const promises = [
    generateSelfContainedWebComponents(config, compilerCtx, buildCtx, selfContainedOutputTargets),
    generateBundledWebComponents(config, compilerCtx, buildCtx, bundledOutputTargets as any)
  ];

  await Promise.all(promises);
}


async function generateSelfContainedWebComponents(config: d.Config, compilerCtx: d.CompilerCtx, buildCtx: d.BuildCtx, outputTargets: d.OutputTargetWebComponent[]) {
  if (outputTargets.length === 0) {
    return;
  }

  const timespan = buildCtx.createTimeSpan(`generate self-contained web components started`, true);

  const promises = buildCtx.moduleFiles.map(async moduleFile => {
    const appModuleFiles = [moduleFile];
    const outputText = await generateWebComponentCore(config, compilerCtx, buildCtx, buildCtx.moduleFiles, appModuleFiles);

    if (!buildCtx.hasError && typeof outputText === 'string') {
      const promises = outputTargets.map(async outputTarget => {
        await writeSelfContainedWebComponentOutput(config, compilerCtx, outputTarget, appModuleFiles, outputText);
      });
      await Promise.all(promises);
    }
  });

  await Promise.all(promises);

  timespan.finish(`generate self-contained web components finished`);
}


async function generateBundledWebComponents(config: d.Config, compilerCtx: d.CompilerCtx, buildCtx: d.BuildCtx, outputTargets: d.OutputTargetWebComponent[]) {
  if (outputTargets.length === 0) {
    return;
  }

  const timespan = buildCtx.createTimeSpan(`generate self-contained web components started`, true);

  const appModuleFiles = buildCtx.moduleFiles;

  const outputText = await generateWebComponentCore(config, compilerCtx, buildCtx, buildCtx.moduleFiles, appModuleFiles);

  if (!buildCtx.hasError && typeof outputText === 'string') {
    await writeBundledWebComponentModes(config, compilerCtx, outputTargets, appModuleFiles, outputText);
  }

  timespan.finish(`generate self-contained web components finished`);
}


async function generateWebComponentCore(config: d.Config, compilerCtx: d.CompilerCtx, buildCtx: d.BuildCtx, allModuleFiles: d.Module[], appModuleFiles: d.Module[]) {
  appModuleFiles.sort((a, b) => {
    if (a.cmpCompilerMeta.tagName < b.cmpCompilerMeta.tagName) return -1;
    if (a.cmpCompilerMeta.tagName > b.cmpCompilerMeta.tagName) return 1;
    return 0;
  });

  const build = getBuildFeatures(allModuleFiles, appModuleFiles) as d.Build;

  build.lazyLoad = false;
  build.es5 = false;
  build.slotPolyfill = false;
  build.polyfills = false;
  build.prerenderClientSide = false;
  build.prerenderServerSide = false;

  updateBuildConditionals(config, build);

  const outputText = await generateAppCore(config, compilerCtx, buildCtx, build);

  return outputText;
}


async function writeSelfContainedWebComponentOutput(config: d.Config, compilerCtx: d.CompilerCtx, outputTarget: d.OutputTargetWebComponent, appModuleFiles: d.Module[], outputText: string) {
  const fileName = `${appModuleFiles[0].cmpCompilerMeta.tagName}.js`;
  const filePath = pathJoin(config, outputTarget.dir, fileName);

  await compilerCtx.fs.writeFile(filePath, outputText);
}


async function writeBundledWebComponentModes(config: d.Config, compilerCtx: d.CompilerCtx, outputTargets: d.OutputTargetWebComponent[], appModuleFiles: d.Module[], outputText: string) {
  const allModes: string[] = [DEFAULT_STYLE_MODE];
  appModuleFiles.forEach(m => {
    if (m.cmpCompilerMeta && m.cmpCompilerMeta.styles) {
      m.cmpCompilerMeta.styles.forEach(style => {
        if (!allModes.includes(style.modeName)) {
          allModes.push(style.modeName);
        }
      });
    }
  });

  const promises: Promise<any>[] = [];

  allModes.forEach(modeName => {
    const modeOutputText = replaceStylePlaceholders(appModuleFiles, modeName, outputText);

    outputTargets.map(async outputTarget => {
      promises.push(
        writeBundledWebComponentOutputMode(config, compilerCtx, outputTarget, modeOutputText, modeName)
      );
    });
  });

  await Promise.all(promises);
}


async function writeBundledWebComponentOutputMode(config: d.Config, compilerCtx: d.CompilerCtx, outputTarget: d.OutputTargetWebComponent, modeOutputText: string, modeName: string) {
  let fileName = `${config.fsNamespace}.`;
  if (modeName !== DEFAULT_STYLE_MODE) {
    fileName += `.${modeName.toLowerCase()}`;
  }
  fileName += `.js`;

  const filePath = pathJoin(config, outputTarget.buildDir, fileName);

  await compilerCtx.fs.writeFile(filePath, modeOutputText);
}