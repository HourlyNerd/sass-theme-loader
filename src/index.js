import sander from 'sander';
import path from 'path';
import _ from 'lodash';
import glob from 'glob';

const STYLE_SOURCE_DIR = '.style-source'

const resourceOrder = new Set();

class StylePackagerPlugin {
    constructor(enabled, outputDir){
        this.enabled = enabled;
        this.outputDir = outputDir;
    }

    apply(compiler) {
        if(!this.enabled){
            return;
        }
        const outputDir = this.outputDir;

        compiler.plugin('compilation', (compilation) => {
            compilation.plugin('after-optimize-tree' , (chunks, modules) => {
                const stylesOutDir = path.join('dist', STYLE_SOURCE_DIR);
                const deps = {};
                const isStyle = fn => fn && fn.match(/\.s?css/i);
                const isScript = fn => fn && fn.match(/\.js/i);
                let records = [];

                const relativizePath = (stylePath) => {
                    if(stylePath.match(/node_modules/)){
                        return path.join(stylesOutDir, 'node_modules', stylePath.split('node_modules').pop());
                    } else if(stylePath.match(/(hn-core\/.+)$/)){
                        return path.join(stylesOutDir, 'node_modules', RegExp.$1);
                    } else {
                        return path.join(stylesOutDir, path.relative(outputDir, stylePath));
                    }
                };

                const recordStylePath = (fn, isDependency) => {
                    if((isDependency && !isScript(fn)) || isStyle(fn)){
                        return deps[fn] = relativizePath(fn);
                    }
                };
                modules.forEach((m) => {

                    const resource = recordStylePath(m.resource);
                    //if the parent res is a style, then all its children should be tracked (things like images, fonts, etc)
                    let deps = _.uniq((m.fileDependencies || [])
                        .map((fn) => recordStylePath(fn, isStyle(m.resource)))
                        .filter(f => f));

                    if(resource || deps.length) {
                        if(deps[0] == resource){
                            deps.shift();
                        }
                        records.push({
                            resource,
                            deps
                        });
                    }
                });
                const order = [...resourceOrder].map(it => relativizePath(it))
                records = _.sortBy(_.uniqBy(records, 'resource'), (it) => {
                    const idx = order.indexOf(it.resource);
                    if(idx >= 0){
                        return idx;
                    } else if(it.resource.match(/\.css$/)){
                        return -1;
                    } else {
                        return order.length;
                    }
                }).map(it => {
                    //css resources which were not in the order list will get included since they are deps of the scss
                    it.exclude = order.indexOf(it.resource) < 0 && it.resource.match(/\.css$/);
                    return it;
                });
                
                const getPackagePath = (stylePath) => {
                    const parts = path.dirname(stylePath).split('node_modules');
                    const packagename = parts.pop().match(/([^\/]+)/)[1];
                    return path.join(parts.join('node_modules'), 'node_modules', packagename);
                };

                sander.rimrafSync(path.join(outputDir, stylesOutDir));
                Object.keys(deps).forEach((stylePath) => {
                    if(stylePath.match(/\.css$/)){
                        // webpack is annoying and doesnt tell me about deps of css files, so i must copy the whole package
                        const packagePath = getPackagePath(stylePath);
                        const searchGlob = path.join(packagePath, "/**/*.+(png|gif|jpeg|jpg|ttf|eot|svg|otf|woff|woff2)");
                        const dependsList = glob.sync(searchGlob);
                        dependsList.push(stylePath);
                        dependsList.forEach((from) => {
                            const ending = path.relative(packagePath, from);
                            if(ending.match(/\/(?:node_modules|examples?|tests?|docs?|jekyll)\//)){
                                return; //dont copy assets out of package's node_modules, they are unlikely to be needed
                            }
                            const to = path.join(getPackagePath(deps[stylePath]), path.relative(packagePath, from));
                            sander.copyFileSync(from).to(path.join(this.outputDir, to));
                        });
                    } else {
                        sander.copyFileSync(stylePath).to(path.join(this.outputDir, deps[stylePath]));
                    }
                });
                sander.writeFileSync(path.join(outputDir, stylesOutDir, 'records.json'), JSON.stringify(records, null, 4));
            });
        });
    }
}

module.exports = function (content) {
    this.cacheable && this.cacheable();
    resourceOrder.add(this.resourcePath);
    return content;
};

module.exports.plugin = StylePackagerPlugin;
module.exports.STYLE_SOURCE_DIR = STYLE_SOURCE_DIR;