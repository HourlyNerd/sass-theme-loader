'use strict';

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _sander = require('sander');

var _sander2 = _interopRequireDefault(_sander);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _glob = require('glob');

var _glob2 = _interopRequireDefault(_glob);

var STYLE_SOURCE_DIR = '.style-source';
var CODMAGIC_START = ' ><> codmagic';
var stylesOutDir = _path2['default'].join('dist', STYLE_SOURCE_DIR);

var relativizePath = function relativizePath(outputDir, stylePath) {
    if (stylePath.match(/node_modules/)) {
        return _path2['default'].join(stylesOutDir, 'node_modules', stylePath.split('node_modules').pop());
    } else if (stylePath.match(/(hn-core\/.+)$/)) {
        return _path2['default'].join(stylesOutDir, 'node_modules', RegExp.$1);
    } else {
        return _path2['default'].join(stylesOutDir, _path2['default'].relative(outputDir, stylePath));
    }
};

var loader = function loader(source) {
    this.cacheable && this.cacheable();
    if (this.resourcePath.match(/\.scss$/)) {
        return '\n /*!' + CODMAGIC_START + ' ' + relativizePath(this.options.context, this.resourcePath) + ' !*/ \n ' + source;
    } else {
        // css files are always included in a scss file. at least I hope they are!
        // we could make it better and support those other scenarios, but this is an internal tool and I need to sleep
        return source;
    }
};

var StylePackagerPlugin = (function () {
    function StylePackagerPlugin(enabled, outputDir) {
        _classCallCheck(this, StylePackagerPlugin);

        this.enabled = enabled;
    }

    _createClass(StylePackagerPlugin, [{
        key: 'apply',
        value: function apply(compiler) {
            if (!this.enabled) {
                return;
            }
            var outputDir = compiler.context;
            var records = [];
            var deps = {};

            // BOOM! trying finding this knowledge bomb in the webpack docs!
            compiler.options.module.preLoaders.push({
                test: /\.s?css$/,
                include: function include() {
                    return true;
                },
                loader: "sass-theme"
            });

            compiler.plugin('done', function (stats) {

                ///////////////////////// begin hacky cod /////////////////////
                // TODO: cheating at 11pm. we can figure out this filename from some object we have access to in here!
                // no really, this needs to be fixed before it breaks
                var cssFilename = 'css/app-' + stats.toJson().hash + '.min.css';
                // TODO: well, i started writing hacky cod, might as well continue!!
                var cssFileBody = _sander2['default'].readFileSync(_path2['default'].join(outputDir, 'dist', cssFilename), { encoding: 'utf8' });
                /////////////////////// end hacky cod ////////////////////////

                var order = [];
                cssFileBody.replace(RegExp('/\\*!' + CODMAGIC_START + ' ([^\\s]+?) !\\*/', 'gm'), function (poop, res) {
                    order.push(res);
                });
                records = _lodash2['default'].sortBy(_lodash2['default'].uniqBy(records, 'resource'), function (it) {
                    var idx = order.indexOf(it.resource);
                    if (idx >= 0) {
                        return idx;
                    } else {
                        return order.length;
                    }
                }).filter(function (it) {
                    //css resources which were not in the order list will get included since they are deps of the scss
                    return !(order.indexOf(it.resource) < 0 && it.resource.match(/\.css$/));
                });

                var getPackagePath = function getPackagePath(stylePath) {
                    var parts = _path2['default'].dirname(stylePath).split('node_modules');
                    var packagename = parts.pop().match(/([^\/]+)/)[1];
                    return _path2['default'].join(parts.join('node_modules'), 'node_modules', packagename);
                };

                _sander2['default'].rimrafSync(_path2['default'].join(outputDir, stylesOutDir));
                Object.keys(deps).forEach(function (stylePath) {
                    if (stylePath.match(/\.css$/)) {
                        (function () {
                            // webpack is annoying and doesnt tell me about deps of css files, so i must copy the whole package
                            var packagePath = getPackagePath(stylePath);
                            var searchGlob = _path2['default'].join(packagePath, "/**/*.+(png|gif|jpeg|jpg|ttf|eot|svg|otf|woff|woff2)");
                            var dependsList = _glob2['default'].sync(searchGlob);
                            dependsList.push(stylePath);
                            dependsList.forEach(function (from) {
                                var ending = _path2['default'].relative(packagePath, from);
                                if (ending.match(/\/(?:node_modules|examples?|tests?|docs?|jekyll)\//)) {
                                    return; //dont copy assets out of package's node_modules, they are unlikely to be needed
                                }
                                var to = _path2['default'].join(getPackagePath(deps[stylePath]), _path2['default'].relative(packagePath, from));
                                _sander2['default'].copyFileSync(from, { encoding: 'utf-8' }).to(_path2['default'].join(outputDir, to), { encoding: 'utf-8' });
                            });
                        })();
                    } else {
                        _sander2['default'].copyFileSync(stylePath, { encoding: 'utf-8' }).to(_path2['default'].join(outputDir, deps[stylePath]), { encoding: 'utf-8' });
                    }
                });
                _sander2['default'].writeFileSync(_path2['default'].join(outputDir, stylesOutDir, 'records.json'), JSON.stringify(records, null, 4));
            });
            compiler.plugin('compilation', function (compilation) {
                compilation.plugin('after-optimize-tree', function (chunks, modules) {

                    var isStyle = function isStyle(fn) {
                        return fn && fn.match(/\.s?css/i);
                    };
                    var isScript = function isScript(fn) {
                        return fn && fn.match(/\.js/i);
                    };

                    var recordStylePath = function recordStylePath(fn, isDependency) {
                        if (isDependency && !isScript(fn) || isStyle(fn)) {
                            return deps[fn] = relativizePath(outputDir, fn);
                        }
                    };
                    modules.forEach(function (m) {

                        var resource = recordStylePath(m.resource);
                        //if the parent res is a style, then all its children should be tracked (things like images, fonts, etc)
                        var deps = _lodash2['default'].uniq((m.fileDependencies || []).map(function (fn) {
                            return recordStylePath(fn, isStyle(m.resource));
                        }).filter(function (f) {
                            return f;
                        }));

                        if (resource || deps.length) {
                            if (deps[0] == resource) {
                                deps.shift();
                            }
                            records.push({
                                resource: resource,
                                deps: deps
                            });
                        }
                    });
                });
            });
        }
    }]);

    return StylePackagerPlugin;
})();

module.exports = loader;
module.exports.plugin = StylePackagerPlugin;
module.exports.STYLE_SOURCE_DIR = STYLE_SOURCE_DIR;