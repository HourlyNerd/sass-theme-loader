'use strict';

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) arr2[i] = arr[i]; return arr2; } else { return Array.from(arr); } }

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

var resourceOrder = new Set();

var StylePackagerPlugin = (function () {
    function StylePackagerPlugin(enabled, outputDir) {
        _classCallCheck(this, StylePackagerPlugin);

        this.enabled = enabled;
        this.outputDir = outputDir;
    }

    _createClass(StylePackagerPlugin, [{
        key: 'apply',
        value: function apply(compiler) {
            var _this = this;

            if (!this.enabled) {
                return;
            }
            var outputDir = this.outputDir;

            compiler.plugin('compilation', function (compilation) {
                compilation.plugin('after-optimize-tree', function (chunks, modules) {
                    var stylesOutDir = _path2['default'].join('dist', STYLE_SOURCE_DIR);
                    var deps = {};
                    var isStyle = function isStyle(fn) {
                        return fn && fn.match(/\.s?css/i);
                    };
                    var isScript = function isScript(fn) {
                        return fn && fn.match(/\.js/i);
                    };
                    var records = [];

                    var relativizePath = function relativizePath(stylePath) {
                        if (stylePath.match(/node_modules/)) {
                            return _path2['default'].join(stylesOutDir, 'node_modules', stylePath.split('node_modules').pop());
                        } else if (stylePath.match(/(hn-core\/.+)$/)) {
                            return _path2['default'].join(stylesOutDir, 'node_modules', RegExp.$1);
                        } else {
                            return _path2['default'].join(stylesOutDir, _path2['default'].relative(outputDir, stylePath));
                        }
                    };

                    var recordStylePath = function recordStylePath(fn, isDependency) {
                        if (isDependency && !isScript(fn) || isStyle(fn)) {
                            return deps[fn] = relativizePath(fn);
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
                    var order = [].concat(_toConsumableArray(resourceOrder)).map(function (it) {
                        return relativizePath(it);
                    });
                    records = _lodash2['default'].sortBy(_lodash2['default'].uniqBy(records, 'resource'), function (it) {
                        var idx = order.indexOf(it.resource);
                        if (idx >= 0) {
                            return idx;
                        } else if (it.resource.match(/\.css$/)) {
                            return -1;
                        } else {
                            return order.length;
                        }
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
                                    _sander2['default'].copyFileSync(from).to(_path2['default'].join(_this.outputDir, to));
                                });
                            })();
                        } else {
                            _sander2['default'].copyFileSync(stylePath).to(_path2['default'].join(_this.outputDir, deps[stylePath]));
                        }
                    });
                    _sander2['default'].writeFileSync(_path2['default'].join(outputDir, stylesOutDir, 'records.json'), JSON.stringify(records, null, 4));
                });
            });
        }
    }]);

    return StylePackagerPlugin;
})();

module.exports = function (content) {
    this.cacheable && this.cacheable();
    resourceOrder.add(this.resourcePath);
    return content;
};

module.exports.plugin = StylePackagerPlugin;
module.exports.STYLE_SOURCE_DIR = STYLE_SOURCE_DIR;