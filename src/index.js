import sander from 'sander';
import path from 'path';
import _ from 'lodash';
import glob from 'glob';

const STYLE_SOURCE_DIR = '.style-source';
const CODMAGIC_START = ' ><> codmagic';
const stylesOutDir = path.join('dist', STYLE_SOURCE_DIR);

// collapse paths so that no matter how deep a node_module is, it will be put at STYLE_SOURCE_DIR/node_modules
// everything else gets rooted at STYLE_SOURCE_DIR/dir
// there is a special case for hn-core in case you are npm linking to it and its not in node_modules
const relativizePath = (outputDir, stylePath) => {
    if(stylePath.match(/node_modules/)){
        return path.join(stylesOutDir, 'node_modules', stylePath.split('node_modules').pop());
    } else if(stylePath.match(/(hn-core\/.+)$/)){
        return path.join(stylesOutDir, 'node_modules', RegExp.$1);
    } else {
        return path.join(stylesOutDir, path.relative(outputDir, stylePath));
    }
};

// this is the magical loader that marks the path of each resource in the final output css. this is the only reliable
// way that i found to figure out the final import order.
const loader = function(source) {
    this.cacheable && this.cacheable();
    if(this.resourcePath.match(/\.scss$/)){
        return `\n /*!${CODMAGIC_START} ${relativizePath(this.options.context, this.resourcePath)} !*/ \n ${source}`;
    } else {
        // css files are always included in a scss file. at least I hope they are!
        // we could make it better and support those other scenarios, but this is an internal tool and I need to sleep
        return source;
    }
};

class StylePackagerPlugin {
    constructor(enabled, outputDir){
        this.enabled = enabled;
    }

    apply(compiler) {
        if(!this.enabled){
            return;
        }
        const outputDir = compiler.context;
        let records = [];
        const deps = {};

        // BOOM! trying finding this knowledge bomb in the webpack docs!
        compiler.options.module.preLoaders.push({
            test: /\.s?css$/,
            include: () => true,
            loader: "sass-theme"
        })


        compiler.plugin('done', (stats) => {

            ///////////////////////// begin hacky cod /////////////////////
            // TODO: cheating at 11pm. we can figure out this filename from some object we have access to in here!
            // no really, this needs to be fixed before it breaks
            const cssFilename = `css/app-${stats.toJson().hash}.min.css`
            // TODO: well, i started writing hacky cod, might as well continue!!
            let cssFileBody;
            try {
                cssFileBody = sander.readFileSync(path.join(outputDir, 'dist', cssFilename), {encoding: 'utf8'});
            } catch(e){
                console.log('!!!!!!ERROR reading app css file at:', cssFilename, e)
                console.error('!! Could not read app css for themeing. This is likely because there was an error in your sass and the file never got made.', e);
                sander.writeFileSync(path.join(outputDir, stylesOutDir, 'records.json'), JSON.stringify({error: 'could not open '+cssFilename, 'message:': e.message}, null, 4));
                return;
            }
            /////////////////////// end hacky cod ////////////////////////

            const order = [];
            cssFileBody.replace(RegExp(`/\\*!${CODMAGIC_START} ([^\\s]+?) !\\*/`, 'gm'), (poop, res) => {
                order.push(res);
            });
            records = _.sortBy(_.uniq(records, 'resource'), (it) => {
                const idx = order.indexOf(it.resource);
                if (idx >= 0) {
                    return idx;
                } else {
                    return order.length;
                }
            }).filter(it => {
                //css resources which were not in the order list will get included since they are deps of the scss
                return !(order.indexOf(it.resource) < 0 && it.resource.match(/\.css$/));
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
                        sander.copyFileSync(from).to(path.join(outputDir, to));
                    });
                } else {
                    sander.copyFileSync(stylePath).to(path.join(outputDir, deps[stylePath]), {encoding: 'utf-8'});
                }
            });
            sander.writeFileSync(path.join(outputDir, stylesOutDir, 'records.json'), JSON.stringify(records, null, 4));
            //const concatted = "";
            //records.map(({resource}) => {
            //    concatted += fs.readFileSync(path.join(outputDir,resource), 'utf8') + "\n\n";
            //});
            //sander.writeFileSync(path.join(outputDir, stylesOutDir, 'index.scss'), JSON.stringify(records, null, 4));
        })
        compiler.plugin('compilation', (compilation) => {
            compilation.plugin('after-optimize-tree' , (chunks, modules) => {

                const isStyle = fn => fn && fn.match(/\.s?css/i);
                const isScript = fn => fn && fn.match(/\.js/i);

                const recordStylePath = (fn, isDependency) => {
                    if((isDependency && !isScript(fn)) || isStyle(fn)){
                        return deps[fn] = relativizePath(outputDir, fn);
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

            });
        });
    }
}

module.exports = loader;
module.exports.plugin = StylePackagerPlugin;
module.exports.STYLE_SOURCE_DIR = STYLE_SOURCE_DIR;