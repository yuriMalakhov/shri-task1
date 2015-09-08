/**
 * Modules
 *
 * Copyright (c) 2013 Filatov Dmitry (dfilatov@yandex-team.ru)
 * Dual licensed under the MIT and GPL licenses:
 * http://www.opensource.org/licenses/mit-license.php
 * http://www.gnu.org/licenses/gpl.html
 *
 * @version 0.1.2
 */

(function(global) {

var undef,

    DECL_STATES = {
        NOT_RESOLVED : 'NOT_RESOLVED',
        IN_RESOLVING : 'IN_RESOLVING',
        RESOLVED     : 'RESOLVED'
    },

    /**
     * Creates a new instance of modular system
     * @returns {Object}
     */
    create = function() {
        var curOptions = {
                trackCircularDependencies : true,
                allowMultipleDeclarations : true
            },

            modulesStorage = {},
            waitForNextTick = false,
            pendingRequires = [],

            /**
             * Defines module
             * @param {String} name
             * @param {String[]} [deps]
             * @param {Function} declFn
             */
            define = function(name, deps, declFn) {
                if(!declFn) {
                    declFn = deps;
                    deps = [];
                }

                var module = modulesStorage[name];
                if(!module) {
                    module = modulesStorage[name] = {
                        name : name,
                        decl : undef
                    };
                }

                module.decl = {
                    name       : name,
                    prev       : module.decl,
                    fn         : declFn,
                    state      : DECL_STATES.NOT_RESOLVED,
                    deps       : deps,
                    dependents : [],
                    exports    : undef
                };
            },

            /**
             * Requires modules
             * @param {String|String[]} modules
             * @param {Function} cb
             * @param {Function} [errorCb]
             */
            require = function(modules, cb, errorCb) {
                if(typeof modules === 'string') {
                    modules = [modules];
                }

                if(!waitForNextTick) {
                    waitForNextTick = true;
                    nextTick(onNextTick);
                }

                pendingRequires.push({
                    deps : modules,
                    cb   : function(exports, error) {
                        error?
                            (errorCb || onError)(error) :
                            cb.apply(global, exports);
                    }
                });
            },

            /**
             * Returns state of module
             * @param {String} name
             * @returns {String} state, possible values are NOT_DEFINED, NOT_RESOLVED, IN_RESOLVING, RESOLVED
             */
            getState = function(name) {
                var module = modulesStorage[name];
                return module?
                    DECL_STATES[module.decl.state] :
                    'NOT_DEFINED';
            },

            /**
             * Returns whether the module is defined
             * @param {String} name
             * @returns {Boolean}
             */
            isDefined = function(name) {
                return !!modulesStorage[name];
            },

            /**
             * Sets options
             * @param {Object} options
             */
            setOptions = function(options) {
                for(var name in options) {
                    if(options.hasOwnProperty(name)) {
                        curOptions[name] = options[name];
                    }
                }
            },

            getStat = function() {
                var res = {},
                    module;

                for(var name in modulesStorage) {
                    if(modulesStorage.hasOwnProperty(name)) {
                        module = modulesStorage[name];
                        (res[module.decl.state] || (res[module.decl.state] = [])).push(name);
                    }
                }

                return res;
            },

            onNextTick = function() {
                waitForNextTick = false;
                applyRequires();
            },

            applyRequires = function() {
                var requiresToProcess = pendingRequires,
                    i = 0, require;

                pendingRequires = [];

                while(require = requiresToProcess[i++]) {
                    requireDeps(null, require.deps, [], require.cb);
                }
            },

            requireDeps = function(fromDecl, deps, path, cb) {
                var unresolvedDepsCnt = deps.length;
                if(!unresolvedDepsCnt) {
                    cb([]);
                }

                var decls = [],
                    onDeclResolved = function(_, error) {
                        if(error) {
                            cb(null, error);
                            return;
                        }

                        if(!--unresolvedDepsCnt) {
                            var exports = [],
                                i = 0, decl;
                            while(decl = decls[i++]) {
                                exports.push(decl.exports);
                            }
                            cb(exports);
                        }
                    },
                    i = 0, len = unresolvedDepsCnt,
                    dep, decl;

                while(i < len) {
                    dep = deps[i++];
                    if(typeof dep === 'string') {
                        if(!modulesStorage[dep]) {
                            cb(null, buildModuleNotFoundError(dep, fromDecl));
                            return;
                        }

                        decl = modulesStorage[dep].decl;
                    }
                    else {
                        decl = dep;
                    }

                    decls.push(decl);

                    startDeclResolving(decl, path, onDeclResolved);
                }
            },

            startDeclResolving = function(decl, path, cb) {
                if(decl.state === DECL_STATES.RESOLVED) {
                    cb(decl.exports);
                    return;
                }
                else if(decl.state === DECL_STATES.IN_RESOLVING) {
                    curOptions.trackCircularDependencies && isDependenceCircular(decl, path)?
                        cb(null, buildCircularDependenceError(decl, path)) :
                        decl.dependents.push(cb);
                    return;
                }

                decl.dependents.push(cb);

                if(decl.prev && !curOptions.allowMultipleDeclarations) {
                    provideError(decl, buildMultipleDeclarationError(decl));
                    return;
                }

                curOptions.trackCircularDependencies && (path = path.slice()).push(decl);

                var isProvided = false,
                    deps = decl.prev? decl.deps.concat([decl.prev]) : decl.deps;

                decl.state = DECL_STATES.IN_RESOLVING;
                requireDeps(
                    decl,
                    deps,
                    path,
                    function(depDeclsExports, error) {
                        if(error) {
                            provideError(decl, error);
                            return;
                        }

                        depDeclsExports.unshift(function(exports, error) {
                            if(isProvided) {
                                cb(null, buildDeclAreadyProvidedError(decl));
                                return;
                            }

                            isProvided = true;
                            error?
                                provideError(decl, error) :
                                provideDecl(decl, exports);
                        });

                        decl.fn.apply(
                            {
                                name   : decl.name,
                                deps   : decl.deps,
                                global : global
                            },
                            depDeclsExports);
                    });
            },

            provideDecl = function(decl, exports) {
                decl.exports = exports;
                decl.state = DECL_STATES.RESOLVED;

                var i = 0, dependent;
                while(dependent = decl.dependents[i++]) {
                    dependent(exports);
                }

                decl.dependents = undef;
            },

            provideError = function(decl, error) {
                decl.state = DECL_STATES.NOT_RESOLVED;

                var i = 0, dependent;
                while(dependent = decl.dependents[i++]) {
                    dependent(null, error);
                }

                decl.dependents = [];
            };

        return {
            create     : create,
            define     : define,
            require    : require,
            getState   : getState,
            isDefined  : isDefined,
            setOptions : setOptions,
            getStat    : getStat
        };
    },

    onError = function(e) {
        nextTick(function() {
            throw e;
        });
    },

    buildModuleNotFoundError = function(name, decl) {
        return Error(decl?
            'Module "' + decl.name + '": can\'t resolve dependence "' + name + '"' :
            'Required module "' + name + '" can\'t be resolved');
    },

    buildCircularDependenceError = function(decl, path) {
        var strPath = [],
            i = 0, pathDecl;
        while(pathDecl = path[i++]) {
            strPath.push(pathDecl.name);
        }
        strPath.push(decl.name);

        return Error('Circular dependence has been detected: "' + strPath.join(' -> ') + '"');
    },

    buildDeclAreadyProvidedError = function(decl) {
        return Error('Declaration of module "' + decl.name + '" has already been provided');
    },

    buildMultipleDeclarationError = function(decl) {
        return Error('Multiple declarations of module "' + decl.name + '" have been detected');
    },

    isDependenceCircular = function(decl, path) {
        var i = 0, pathDecl;
        while(pathDecl = path[i++]) {
            if(decl === pathDecl) {
                return true;
            }
        }
        return false;
    },

    nextTick = (function() {
        var fns = [],
            enqueueFn = function(fn) {
                return fns.push(fn) === 1;
            },
            callFns = function() {
                var fnsToCall = fns, i = 0, len = fns.length;
                fns = [];
                while(i < len) {
                    fnsToCall[i++]();
                }
            };

        if(typeof process === 'object' && process.nextTick) { // nodejs
            return function(fn) {
                enqueueFn(fn) && process.nextTick(callFns);
            };
        }

        if(global.setImmediate) { // ie10
            return function(fn) {
                enqueueFn(fn) && global.setImmediate(callFns);
            };
        }

        if(global.postMessage && !global.opera) { // modern browsers
            var isPostMessageAsync = true;
            if(global.attachEvent) {
                var checkAsync = function() {
                        isPostMessageAsync = false;
                    };
                global.attachEvent('onmessage', checkAsync);
                global.postMessage('__checkAsync', '*');
                global.detachEvent('onmessage', checkAsync);
            }

            if(isPostMessageAsync) {
                var msg = '__modules' + (+new Date()),
                    onMessage = function(e) {
                        if(e.data === msg) {
                            e.stopPropagation && e.stopPropagation();
                            callFns();
                        }
                    };

                global.addEventListener?
                    global.addEventListener('message', onMessage, true) :
                    global.attachEvent('onmessage', onMessage);

                return function(fn) {
                    enqueueFn(fn) && global.postMessage(msg, '*');
                };
            }
        }

        var doc = global.document;
        if('onreadystatechange' in doc.createElement('script')) { // ie6-ie8
            var head = doc.getElementsByTagName('head')[0],
                createScript = function() {
                    var script = doc.createElement('script');
                    script.onreadystatechange = function() {
                        script.parentNode.removeChild(script);
                        script = script.onreadystatechange = null;
                        callFns();
                    };
                    head.appendChild(script);
                };

            return function(fn) {
                enqueueFn(fn) && createScript();
            };
        }

        return function(fn) { // old browsers
            enqueueFn(fn) && setTimeout(callFns, 0);
        };
    })();

if(typeof exports === 'object') {
    module.exports = create();
}
else {
    global.modules = create();
}

})(typeof window !== 'undefined' ? window : global);
if(typeof module !== 'undefined') {modules = module.exports;}
modules.define('bh', [], function(provide) {
var BH = (function() {

var lastGenId = 0;

/**
 * BH: BEMJSON -> HTML процессор.
 * @constructor
 */
function BH() {
    /**
     * Используется для идентификации шаблонов.
     * Каждому шаблону дается уникальный id для того, чтобы избежать повторного применения
     * шаблона к одному и тому же узлу BEMJSON-дерева.
     * @type {Number}
     * @private
     */
    this._lastMatchId = 0;
    /**
     * Плоский массив для хранения матчеров.
     * Каждый элемент — массив с двумя элементами: [{String} выражение, {Function} шаблон}]
     * @type {Array}
     * @private
     */
    this._matchers = [];
    /**
     * Флаг, включающий автоматическую систему поиска зацикливаний. Следует использовать в development-режиме,
     * чтобы определять причины зацикливания.
     * @type {Boolean}
     * @private
     */
    this._infiniteLoopDetection = false;

    /**
     * Неймспейс для библиотек. Сюда можно писать различный функционал для дальнейшего использования в шаблонах.
     * ```javascript
     * bh.lib.objects = bh.lib.objects || {};
     * bh.lib.objects.inverse = bh.lib.objects.inverse || function(obj) { ... };
     * ```
     * @type {Object}
     */
    this.lib = {};
    this._inited = false;
    /**
     * Опции BH. Задаются через setOptions.
     * @type {Object}
     */
    this._options = {};
    this._optJsAttrName = 'onclick';
    this._optJsAttrIsJs = true;
    this._optEscapeContent = false;
    this.utils = {
        _expandoId: new Date().getTime(),
        bh: this,
        /**
         * Проверяет, что объект является примитивом.
         * ```javascript
         * bh.match('link', function(ctx) {
         *     ctx.tag(ctx.isSimple(ctx.content()) ? 'span' : 'div');
         * });
         * ```
         * @param {*} obj
         * @returns {Boolean}
         */
        isSimple: function(obj) {
            if (!obj || obj === true) return true;
            var t = typeof obj;
            return t === 'string' || t === 'number';
        },
        /**
         * Расширяет один объект свойствами другого (других).
         * Аналог jQuery.extend.
         * ```javascript
         * obj = ctx.extend(obj, {a: 1});
         * ```
         * @param {Object} target
         * @returns {Object}
         */
        extend: function(target) {
            if (!target || typeof target !== 'object') {
                target = {};
            }
            for (var i = 1, len = arguments.length; i < len; i++) {
                var obj = arguments[i],
                    key;
                /* istanbul ignore else */
                if (obj) {
                    for (key in obj) {
                        target[key] = obj[key];
                    }
                }
            }
            return target;
        },
        /**
         * Возвращает позицию элемента в рамках родителя.
         * Отсчет производится с 1 (единицы).
         * ```javascript
         * bh.match('list__item', function(ctx) {
         *     ctx.mod('pos', ctx.position());
         * });
         * ```
         * @returns {Number}
         */
        position: function() {
            var node = this.node;
            return node.index === 'content' ? 1 : node.position;
        },
        /**
         * Возвращает true, если текущий BEMJSON-элемент первый в рамках родительского BEMJSON-элемента.
         * ```javascript
         * bh.match('list__item', function(ctx) {
         *     if (ctx.isFirst()) {
         *         ctx.mod('first', 'yes');
         *     }
         * });
         * ```
         * @returns {Boolean}
         */
        isFirst: function() {
            var node = this.node;
            return node.index === 'content' || node.position === 1;
        },
        /**
         * Возвращает true, если текущий BEMJSON-элемент последний в рамках родительского BEMJSON-элемента.
         * ```javascript
         * bh.match('list__item', function(ctx) {
         *     if (ctx.isLast()) {
         *         ctx.mod('last', 'yes');
         *     }
         * });
         * ```
         * @returns {Boolean}
         */
        isLast: function() {
            var node = this.node;
            return node.index === 'content' || node.position === node.arr._listLength;
        },
        /**
         * Передает параметр вглубь BEMJSON-дерева.
         * **force** — задать значение параметра даже если оно было задано ранее.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     ctx.content({ elem: 'control' });
         *     ctx.tParam('value', ctx.param('value'));
         * });
         * bh.match('input__control', function(ctx) {
         *     ctx.attr('value', ctx.tParam('value'));
         * });
         * ```
         * @param {String} key
         * @param {*} value
         * @param {Boolean} [force]
         * @returns {*|Ctx}
         */
        tParam: function(key, value, force) {
            var keyName = '__tp_' + key;
            var node = this.node;
            if (arguments.length > 1) {
                if (force || !node.hasOwnProperty(keyName))
                    node[keyName] = value;
                return this;
            } else {
                while (node) {
                    if (node.hasOwnProperty(keyName)) {
                        return node[keyName];
                    }
                    node = node.parentNode;
                }
                return undefined;
            }
        },
        /**
         * Применяет матчинг для переданного фрагмента BEMJSON.
         * Возвращает результат преобразований.
         * @param {BemJson} bemJson
         * @returns {Object|Array}
         */
        apply: function(bemJson) {
            var prevCtx = this.ctx,
                prevNode = this.node;
            var res = this.bh.processBemJson(bemJson, prevCtx.block);
            this.ctx = prevCtx;
            this.node = prevNode;
            return res;
        },
        /**
         * Выполняет преобразования данного BEMJSON-элемента остальными шаблонами.
         * Может понадобиться, например, чтобы добавить элемент в самый конец содержимого, если в базовых шаблонах в конец содержимого добавляются другие элементы.
         * Пример:
         * ```javascript
         * bh.match('header', function(ctx) {
         *    ctx.content([
         *        ctx.content(),
         *        { elem: 'under' }
         *    ], true);
         * });
         * bh.match('header_float_yes', function(ctx) {
         *    ctx.applyBase();
         *    ctx.content([
         *        ctx.content(),
         *        { elem: 'clear' }
         *    ], true);
         * });
         * ```
         * @returns {Ctx}
         */
        applyBase: function() {
            var node = this.node;
            var json = node.json;

            if (!json.elem && json.mods) json.blockMods = json.mods;
            var block = json.block;
            var blockMods = json.blockMods;

            var subRes = this.bh._fastMatcher(this, json);
            if (subRes !== undefined) {
                this.ctx = node.arr[node.index] = node.json = subRes;
                node.blockName = block;
                node.blockMods = blockMods;
            }
            return this;
        },
        /**
         * Останавливает выполнение прочих шаблонов для данного BEMJSON-элемента.
         * Пример:
         * ```javascript
         * bh.match('button', function(ctx) {
         *     ctx.tag('button', true);
         * });
         * bh.match('button', function(ctx) {
         *     ctx.tag('span');
         *     ctx.stop();
         * });
         * ```
         * @returns {Ctx}
         */
        stop: function() {
            this.ctx._stop = true;
            return this;
        },
        /**
         * Возвращает уникальный идентификатор. Может использоваться, например,
         * чтобы задать соответствие между `label` и `input`.
         * @returns {String}
         */
        generateId: function() {
            return 'uniq' + this._expandoId + (++lastGenId);
        },
        /**
         * Возвращает/устанавливает модификатор в зависимости от аргументов.
         * **force** — задать модификатор даже если он был задан ранее.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     ctx.mod('native', 'yes');
         *     ctx.mod('disabled', true);
         * });
         * bh.match('input_islands_yes', function(ctx) {
         *     ctx.mod('native', '', true);
         *     ctx.mod('disabled', false, true);
         * });
         * ```
         * @param {String} key
         * @param {String|Boolean} [value]
         * @param {Boolean} [force]
         * @returns {String|undefined|Ctx}
         */
        mod: function(key, value, force) {
            var mods;
            if (arguments.length > 1) {
                mods = this.ctx.mods || (this.ctx.mods = {});
                mods[key] = !mods.hasOwnProperty(key) || force ? value : mods[key];
                return this;
            } else {
                mods = this.ctx.mods;
                return mods ? mods[key] : undefined;
            }
        },
        /**
         * Возвращает/устанавливает модификаторы в зависимости от аргументов.
         * **force** — задать модификаторы даже если они были заданы ранее.
         * ```javascript
         * bh.match('paranja', function(ctx) {
         *     ctx.mods({
         *         theme: 'normal',
         *         disabled: true
         *     });
         * });
         * ```
         * @param {Object} [values]
         * @param {Boolean} [force]
         * @returns {Object|Ctx}
         */
        mods: function(values, force) {
            var mods = this.ctx.mods || (this.ctx.mods = {});
            if (values !== undefined) {
                this.ctx.mods = force ? this.extend(mods, values) : this.extend(values, mods);
                return this;
            } else {
                return mods;
            }
        },
        /**
         * Возвращает/устанавливает тег в зависимости от аргументов.
         * **force** — задать значение тега даже если оно было задано ранее.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     ctx.tag('input');
         * });
         * ```
         * @param {String} [tagName]
         * @param {Boolean} [force]
         * @returns {String|undefined|Ctx}
         */
        tag: function(tagName, force) {
            if (tagName !== undefined) {
                this.ctx.tag = this.ctx.tag === undefined || force ? tagName : this.ctx.tag;
                return this;
            } else {
                return this.ctx.tag;
            }
        },
        /**
         * Возвращает/устанавливает значение mix в зависимости от аргументов.
         * При установке значения, если force равен true, то переданный микс заменяет прежнее значение,
         * в противном случае миксы складываются.
         * ```javascript
         * bh.match('button_pseudo_yes', function(ctx) {
         *     ctx.mix({ block: 'link', mods: { pseudo: 'yes' } });
         *     ctx.mix([
         *         { elem: 'text' },
         *         { block: 'ajax' }
         *     ]);
         * });
         * ```
         * @param {Array|BemJson} [mix]
         * @param {Boolean} [force]
         * @returns {Array|undefined|Ctx}
         */
        mix: function(mix, force) {
            if (mix !== undefined) {
                if (force) {
                    this.ctx.mix = mix;
                } else {
                    if (this.ctx.mix) {
                        this.ctx.mix = Array.isArray(this.ctx.mix) ?
                            this.ctx.mix.concat(mix) :
                            [this.ctx.mix].concat(mix);
                    } else {
                        this.ctx.mix = mix;
                    }
                }
                return this;
            } else {
                return this.ctx.mix;
            }
        },
        /**
         * Возвращает/устанавливает значение атрибута в зависимости от аргументов.
         * **force** — задать значение атрибута даже если оно было задано ранее.
         * @param {String} key
         * @param {String} [value]
         * @param {Boolean} [force]
         * @returns {String|undefined|Ctx}
         */
        attr: function(key, value, force) {
            var attrs;
            if (arguments.length > 1) {
                attrs = this.ctx.attrs || (this.ctx.attrs = {});
                attrs[key] = !attrs.hasOwnProperty(key) || force ? value : attrs[key];
                return this;
            } else {
                attrs = this.ctx.attrs;
                return attrs ? attrs[key] : undefined;
            }
        },
        /**
         * Возвращает/устанавливает атрибуты в зависимости от аргументов.
         * **force** — задать атрибуты даже если они были заданы ранее.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     ctx.attrs({
         *         name: ctx.param('name'),
         *         autocomplete: 'off'
         *     });
         * });
         * ```
         * @param {Object} [values]
         * @param {Boolean} [force]
         * @returns {Object|Ctx}
         */
        attrs: function(values, force) {
            var attrs = this.ctx.attrs || {};
            if (values !== undefined) {
                this.ctx.attrs = force ? this.extend(attrs, values) : this.extend(values, attrs);
                return this;
            } else {
                return attrs;
            }
        },
        /**
         * Возвращает/устанавливает значение bem в зависимости от аргументов.
         * **force** — задать значение bem даже если оно было задано ранее.
         * Если `bem` имеет значение `false`, то для элемента не будут генерироваться BEM-классы.
         * ```javascript
         * bh.match('meta', function(ctx) {
         *     ctx.bem(false);
         * });
         * ```
         * @param {Boolean} [bem]
         * @param {Boolean} [force]
         * @returns {Boolean|undefined|Ctx}
         */
        bem: function(bem, force) {
            if (bem !== undefined) {
                this.ctx.bem = this.ctx.bem === undefined || force ? bem : this.ctx.bem;
                return this;
            } else {
                return this.ctx.bem;
            }
        },
        /**
         * Возвращает/устанавливает значение `js` в зависимости от аргументов.
         * **force** — задать значение `js` даже если оно было задано ранее.
         * Значение `js` используется для инициализации блоков в браузере через `BEM.DOM.init()`.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     ctx.js(true);
         * });
         * ```
         * @param {Boolean|Object} [js]
         * @param {Boolean} [force]
         * @returns {Boolean|Object|Ctx}
         */
        js: function(js, force) {
            if (js !== undefined) {
                this.ctx.js = force ?
                    (js === true ? {} : js) :
                    js ? this.extend(this.ctx.js, js) : this.ctx.js;
                return this;
            } else {
                return this.ctx.js;
            }
        },
        /**
         * Возвращает/устанавливает значение CSS-класса в зависимости от аргументов.
         * **force** — задать значение CSS-класса даже если оно было задано ранее.
         * ```javascript
         * bh.match('page', function(ctx) {
         *     ctx.cls('ua_js_no ua_css_standard');
         * });
         * ```
         * @param {String} [cls]
         * @param {Boolean} [force]
         * @returns {String|Ctx}
         */
        cls: function(cls, force) {
            if (cls !== undefined) {
                this.ctx.cls = this.ctx.cls === undefined || force ? cls : this.ctx.cls;
                return this;
            } else {
                return this.ctx.cls;
            }
        },
        /**
         * Возвращает/устанавливает параметр текущего BEMJSON-элемента.
         * **force** — задать значение параметра, даже если оно было задано ранее.
         * Например:
         * ```javascript
         * // Пример входного BEMJSON: { block: 'search', action: '/act' }
         * bh.match('search', function(ctx) {
         *     ctx.attr('action', ctx.param('action') || '/');
         * });
         * ```
         * @param {String} key
         * @param {*} [value]
         * @param {Boolean} [force]
         * @returns {*|Ctx}
         */
        param: function(key, value, force) {
            if (value !== undefined) {
                this.ctx[key] = this.ctx[key] === undefined || force ? value : this.ctx[key];
                return this;
            } else {
                return this.ctx[key];
            }
        },
        /**
         * Возвращает/устанавливает защищенное содержимое в зависимости от аргументов.
         * **force** — задать содержимое даже если оно было задано ранее.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     ctx.content({ elem: 'control' });
         * });
         * ```
         * @param {BemJson} [value]
         * @param {Boolean} [force]
         * @returns {BemJson|Ctx}
         */
        content: function(value, force) {
            if (arguments.length > 0) {
                this.ctx.content = this.ctx.content === undefined || force ? value : this.ctx.content;
                return this;
            } else {
                return this.ctx.content;
            }
        },
        /**
         * Возвращает/устанавливает незащищенное содержимое в зависимости от аргументов.
         * **force** — задать содержимое даже если оно было задано ранее.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     ctx.html({ elem: 'control' });
         * });
         * ```
         * @param {String} [value]
         * @param {Boolean} [force]
         * @returns {String|Ctx}
         */
        html: function(value, force) {
            if (arguments.length > 0) {
                this.ctx.html = this.ctx.html === undefined || force ? value : this.ctx.html;
                return this;
            } else {
                return this.ctx.html;
            }
        },
        /**
         * Возвращает текущий фрагмент BEMJSON-дерева.
         * Может использоваться в связке с `return` для враппинга и подобных целей.
         * ```javascript
         * bh.match('input', function(ctx) {
         *     return {
         *         elem: 'wrapper',
         *         content: ctx.json()
         *     };
         * });
         * ```
         * @returns {Object|Array}
         */
        json: function() {
            return this.ctx;
        }
    };
}

BH.prototype = {

    /**
     * Задает опции шаблонизации.
     *
     * @param {Object} options
     *        {String} options[jsAttrName] Атрибут, в который записывается значение поля `js`. По умолчанию, `onclick`.
     *        {String} options[jsAttrScheme] Схема данных для `js`-значения.
     *                 Форматы:
     *                     `js` — значение по умолчанию. Получаем `return { ... }`.
     *                     `json` — JSON-формат. Получаем `{ ... }`.
     * @returns {BH}
     */
    setOptions: function(options) {
        var i;
        for (i in options) {
            this._options[i] = options[i];
        }
        if (options.jsAttrName) {
            this._optJsAttrName = options.jsAttrName;
        }
        if (options.jsAttrScheme) {
            this._optJsAttrIsJs = options.jsAttrScheme === 'js';
        }
        if (options.escapeContent) {
            this._optEscapeContent = options.escapeContent;
        }
        return this;
    },

    /**
     * Возвращает опции шаблонизации.
     *
     * @returns {Object}
     */
    getOptions: function() {
        return this._options;
    },

    /**
     * Включает/выключает механизм определения зацикливаний.
     *
     * @param {Boolean} enable
     * @returns {BH}
     */
    enableInfiniteLoopDetection: function(enable) {
        this._infiniteLoopDetection = enable;
        return this;
    },

    /**
     * Преобразует BEMJSON в HTML-код.
     * @param {BemJson} bemJson
     * @returns {String}
     */
    apply: function(bemJson) {
        return this.toHtml(this.processBemJson(bemJson));
    },

    /**
     * Объявляет шаблон.
     * ```javascript
     * bh.match('page', function(ctx) {
     *     ctx.mix([{ block: 'ua' }]);
     *     ctx.cls('ua_js_no ua_css_standard');
     * });
     * bh.match('block_mod_modVal', function(ctx) {
     *     ctx.tag('span');
     * });
     * bh.match('block__elem', function(ctx) {
     *     ctx.attr('disabled', 'disabled');
     * });
     * bh.match('block__elem_elemMod', function(ctx) {
     *     ctx.mix([{ block: 'link' }]);
     * });
     * bh.match('block__elem_elemMod_elemModVal', function(ctx) {
     *     ctx.mod('active', 'yes');
     * });
     * bh.match('block_blockMod__elem', function(ctx) {
     *     ctx.param('checked', true);
     * });
     * bh.match('block_blockMod_blockModVal__elem', function(ctx) {
     *     ctx.content({
     *         elem: 'wrapper',
     *         content: ctx
     *     };
     * });
     * ```
     * @param {String|Array|Object} expr
     * @param {Function} matcher
     * @returns {BH}
     */
    match: function(expr, matcher) {
        if (!expr) return this;

        if (Array.isArray(expr)) {
            expr.forEach(function(match, i) {
                this.match(expr[i], matcher);
            }, this);
            return this;
        }

        if (typeof expr === 'object') {
            for (var i in expr) {
                this.match(i, expr[i]);
            }
            return this;
        }

        matcher.__id = '__func' + (this._lastMatchId++);
        this._matchers.push([expr, matcher]);
        this._fastMatcher = null;
        return this;
    },

    /**
     * Вспомогательный метод для компиляции шаблонов с целью их быстрого дальнейшего исполнения.
     * @returns {String}
     */
    buildMatcher: function() {

        /**
         * Группирует селекторы матчеров по указанному ключу.
         * @param {Array} data
         * @param {String} key
         * @returns {Object}
         */
        function groupBy(data, key) {
            var res = {};
            for (var i = 0, l = data.length; i < l; i++) {
                var item = data[i];
                var value = item[key] || '__no_value__';
                (res[value] || (res[value] = [])).push(item);
            }
            return res;
        }

        var i, j, l;
        var res = [];
        var vars = ['bh = this'];
        var allMatchers = this._matchers;
        var decl, expr, matcherInfo;
        var declarations = [], exprBits, blockExprBits;
        for (i = allMatchers.length - 1; i >= 0; i--) {
            matcherInfo = allMatchers[i];
            expr = matcherInfo[0];
            vars.push('_m' + i + ' = ms[' + i + '][1]');
            decl = { fn: matcherInfo[1], index: i };
            if (~expr.indexOf('__')) {
                exprBits = expr.split('__');
                blockExprBits = exprBits[0].split('_');
                decl.block = blockExprBits[0];
                if (blockExprBits.length > 1) {
                    decl.blockMod = blockExprBits[1];
                    decl.blockModVal = blockExprBits[2] || true;
                }
                exprBits = exprBits[1].split('_');
                decl.elem = exprBits[0];
                if (exprBits.length > 1) {
                    decl.elemMod = exprBits[1];
                    decl.elemModVal = exprBits[2] || true;
                }
            } else {
                exprBits = expr.split('_');
                decl.block = exprBits[0];
                if (exprBits.length > 1) {
                    decl.blockMod = exprBits[1];
                    decl.blockModVal = exprBits[2] || true;
                }
            }
            declarations.push(decl);
        }
        var declByBlock = groupBy(declarations, 'block');
        res.push('var ' + vars.join(', ') + ';');
        res.push('function applyMatchers(ctx, json) {');
        res.push('var subRes;');

        res.push('switch (json.block) {');
        for (var blockName in declByBlock) {
            res.push('case "' + blockName + '":');
            var declsByElem = groupBy(declByBlock[blockName], 'elem');

            res.push('switch (json.elem) {');
            for (var elemName in declsByElem) {
                if (elemName === '__no_value__') {
                    res.push('case undefined:');
                } else {
                    res.push('case "' + elemName + '":');
                }
                var decls = declsByElem[elemName];
                for (j = 0, l = decls.length; j < l; j++) {
                    decl = decls[j];
                    var fn = decl.fn;
                    var conds = [];
                    conds.push('!json.' + fn.__id);
                    if (decl.elemMod) {
                        conds.push(
                            'json.mods && json.mods["' + decl.elemMod + '"] === ' +
                                (decl.elemModVal === true || '"' + decl.elemModVal + '"'));
                    }
                    if (decl.blockMod) {
                        conds.push(
                            'json.blockMods["' + decl.blockMod + '"] === ' +
                                (decl.blockModVal === true || '"' + decl.blockModVal + '"'));
                    }
                    res.push('if (' + conds.join(' && ') + ') {');
                    res.push('json.' + fn.__id + ' = true;');
                    res.push('subRes = _m' + decl.index + '(ctx, json);');
                    res.push('if (subRes !== undefined) { return (subRes || "") }');
                    res.push('if (json._stop) return;');
                    res.push('}');
                }
                res.push('return;');
            }
            res.push('}');

            res.push('return;');
        }
        res.push('}');
        res.push('};');
        res.push('return applyMatchers;');
        return res.join('\n');
    },

    /**
     * Раскрывает BEMJSON, превращая его из краткого в полный.
     * @param {BemJson} bemJson
     * @param {String} [blockName]
     * @param {Boolean} [ignoreContent]
     * @returns {Object|Array}
     */
    processBemJson: function(bemJson, blockName, ignoreContent) {
        if (bemJson == null) return;
        if (!this._inited) {
            this._init();
        }
        var resultArr = [bemJson];
        var nodes = [{ json: bemJson, arr: resultArr, index: 0, blockName: blockName, blockMods: !bemJson.elem && bemJson.mods || {} }];
        var node, json, block, blockMods, i, j, l, p, child, subRes;
        var compiledMatcher = (this._fastMatcher || (this._fastMatcher = Function('ms', this.buildMatcher())(this._matchers)));
        var processContent = !ignoreContent;
        var infiniteLoopDetection = this._infiniteLoopDetection;

        /**
         * Враппер для json-узла.
         * @constructor
         */
        function Ctx() {
            this.ctx = null;
        }
        Ctx.prototype = this.utils;
        var ctx = new Ctx();
        while (node = nodes.shift()) {
            json = node.json;
            block = node.blockName;
            blockMods = node.blockMods;
            if (Array.isArray(json)) {
                for (i = 0, j = 0, l = json.length; i < l; i++) {
                    child = json[i];
                    if (child !== false && child != null && typeof child === 'object') {
                        nodes.push({ json: child, arr: json, index: i, position: ++j, blockName: block, blockMods: blockMods, parentNode: node });
                    }
                }
                json._listLength = j;
            } else {
                var content, stopProcess = false;
                if (json.elem) {
                    block = json.block = json.block || block;
                    blockMods = json.blockMods = json.blockMods || blockMods;
                    if (json.elemMods) {
                        json.mods = json.elemMods;
                    }
                } else if (json.block) {
                    block = json.block;
                    blockMods = json.blockMods = json.mods || {};
                }

                if (json.block) {

                    if (infiniteLoopDetection) {
                        json.__processCounter = (json.__processCounter || 0) + 1;
                        compiledMatcher.__processCounter = (compiledMatcher.__processCounter || 0) + 1;
                        if (json.__processCounter > 100) {
                            throw new Error('Infinite json loop detected at "' + json.block + (json.elem ? '__' + json.elem : '') + '".');
                        }
                        if (compiledMatcher.__processCounter > 1000) {
                            throw new Error('Infinite matcher loop detected at "' + json.block + (json.elem ? '__' + json.elem : '') + '".');
                        }
                    }

                    subRes = undefined;

                    /* istanbul ignore else */
                    if (!json._stop) {
                        ctx.node = node;
                        ctx.ctx = json;
                        subRes = compiledMatcher(ctx, json);
                        if (subRes !== undefined) {
                            json = subRes;
                            node.json = json;
                            node.blockName = block;
                            node.blockMods = blockMods;
                            nodes.push(node);
                            stopProcess = true;
                        }
                    }

                }
                if (!stopProcess) {
                    if (processContent && (content = json.content)) {
                        if (Array.isArray(content)) {
                            var flatten;
                            do {
                                flatten = false;
                                for (i = 0, l = content.length; i < l; i++) {
                                    if (Array.isArray(content[i])) {
                                        flatten = true;
                                        break;
                                    }
                                }
                                if (flatten) {
                                    json.content = content = content.concat.apply([], content);
                                }
                            } while (flatten);
                            for (i = 0, j = 0, l = content.length, p = l - 1; i < l; i++) {
                                child = content[i];
                                if (child !== false && child != null && typeof child === 'object') {
                                    nodes.push({ json: child, arr: content, index: i, position: ++j, blockName: block, blockMods: blockMods, parentNode: node });
                                }
                            }
                            content._listLength = j;
                        } else {
                            nodes.push({ json: content, arr: json, index: 'content', blockName: block, blockMods: blockMods, parentNode: node });
                        }
                    }
                }
            }
            node.arr[node.index] = json;
        }
        return resultArr[0];
    },

    /**
     * Превращает раскрытый BEMJSON в HTML.
     * @param {BemJson} json
     * @returns {String}
     */
    toHtml: function(json) {
        var res, i, l, item;
        if (json === false || json == null) return '';
        if (typeof json !== 'object') {
            return this._optEscapeContent ? xmlEscape(json) : json;
        } else if (Array.isArray(json)) {
            res = '';
            for (i = 0, l = json.length; i < l; i++) {
                item = json[i];
                if (item !== false && item != null) {
                    res += this.toHtml(item);
                }
            }
            return res;
        } else {
            var isBEM = json.bem !== false;
            if (typeof json.tag !== 'undefined' && !json.tag) {
                return json.html || json.content ? this.toHtml(json.content) : '';
            }
            if (json.mix && !Array.isArray(json.mix)) {
                json.mix = [json.mix];
            }
            var cls = '',
                jattr, jval, attrs = '', jsParams, hasMixJsParams = false;

            if (jattr = json.attrs) {
                for (i in jattr) {
                    jval = jattr[i];
                    if (jval !== null && jval !== undefined) {
                        attrs += ' ' + i + '="' + attrEscape(jval) + '"';
                    }
                }
            }

            if (isBEM) {
                var base = json.block + (json.elem ? '__' + json.elem : '');

                if (json.block) {
                    cls = toBemCssClasses(json, base);
                    if (json.js) {
                        (jsParams = {})[base] = json.js === true ? {} : json.js;
                    }
                }

                var addJSInitClass = jsParams && !json.elem;

                var mixes = json.mix;
                if (mixes && mixes.length) {
                    for (i = 0, l = mixes.length; i < l; i++) {
                        var mix = mixes[i];
                        if (mix && mix.bem !== false) {
                            var mixBlock = mix.block || json.block || '',
                                mixElem = mix.elem || (mix.block ? null : json.block && json.elem),
                                mixBase = mixBlock + (mixElem ? '__' + mixElem : '');

                            if (mixBlock) {
                                cls += toBemCssClasses(mix, mixBase, base);
                                if (mix.js) {
                                    (jsParams = jsParams || {})[mixBase] = mix.js === true ? {} : mix.js;
                                    hasMixJsParams = true;
                                    if (!addJSInitClass) addJSInitClass = mixBlock && !mixElem;
                                }
                            }
                        }
                    }
                }

                if (jsParams) {
                    if (addJSInitClass) cls += ' i-bem';
                    var jsData = (!hasMixJsParams && json.js === true ?
                        '{&quot;' + base + '&quot;:{}}' :
                        attrEscape(JSON.stringify(jsParams)));
                    attrs += ' ' + (json.jsAttr || this._optJsAttrName) + '="' +
                        (this._optJsAttrIsJs ? 'return ' + jsData : jsData) + '"';
                }
            }

            if (json.cls) {
                cls = cls ? cls + ' ' + json.cls : json.cls;
            }

            var content, tag = (json.tag || 'div');
            res = '<' + tag + (cls ? ' class="' + attrEscape(cls) + '"' : '') + (attrs ? attrs : '');

            if (selfCloseHtmlTags[tag]) {
                res += '/>';
            } else {
                res += '>';
                if (json.html) {
                    res += json.html;
                } else if ((content = json.content) != null) {
                    if (Array.isArray(content)) {
                        for (i = 0, l = content.length; i < l; i++) {
                            item = content[i];
                            if (item !== false && item != null) {
                                res += this.toHtml(item);
                            }
                        }
                    } else {
                        res += this.toHtml(content);
                    }
                }
                res += '</' + tag + '>';
            }
            return res;
        }
    },

    /**
     * Инициализация BH.
     */
    _init: function() {
        this._inited = true;
        /*
            Копируем ссылку на BEM.I18N в bh.lib.i18n, если это возможно.
        */
        if (typeof BEM !== 'undefined' && typeof BEM.I18N !== 'undefined') {
            this.lib.i18n = this.lib.i18n || BEM.I18N;
        }
    }
};

/**
 * @deprecated
 */
BH.prototype.processBemjson = BH.prototype.processBemJson;

var selfCloseHtmlTags = {
    area: 1,
    base: 1,
    br: 1,
    col: 1,
    command: 1,
    embed: 1,
    hr: 1,
    img: 1,
    input: 1,
    keygen: 1,
    link: 1,
    menuitem: 1,
    meta: 1,
    param: 1,
    source: 1,
    track: 1,
    wbr: 1
};

var xmlEscape = BH.prototype.xmlEscape = function(str) {
    return (str + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
var attrEscape = BH.prototype.attrEscape = function(str) {
    return (str + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

var toBemCssClasses = function(json, base, parentBase) {
    var mods, mod, res = '', i;

    if (parentBase !== base) {
        if (parentBase) res += ' ';
        res += base;
    }

    if (mods = json.mods || json.elem && json.elemMods) {
        for (i in mods) {
            mod = mods[i];
            if (mod || mod === 0) {
                res += ' ' + base + '_' + i + (mod === true ? '' : '_' + mod);
            }
        }
    }
    return res;
};

return BH;
})();

/* istanbul ignore else */
if (typeof module !== 'undefined') {
    module.exports = BH;
}

var bh = new BH();
bh.setOptions({
    jsAttrName: 'data-bem',
    jsAttrScheme: 'json'
});
// begin: ../../common.blocks/grid/__head/grid__head.bh.js

    bh.match('grid__head', function (ctx) {
        ctx.content([
            {
                elem: 'row',
                elemMods: {head: true},
                mode: ctx.param('mode')
            }
        ], true);
    });

// end: ../../common.blocks/grid/__head/grid__head.bh.js
// begin: ../../libs/bem-core/common.blocks/ua/ua.bh.js


    bh.match('ua', function(ctx) {
        ctx
            .bem(false)
            .tag('script')
            .content([
                '(function(e,c){',
                    'e[c]=e[c].replace(/(ua_js_)no/g,"$1yes");',
                '})(document.documentElement,"className");'
            ], true);
    });


// end: ../../libs/bem-core/common.blocks/ua/ua.bh.js
// begin: ../../common.blocks/grid/__row/_head/grid__row_head.bh.js

    bh.match('grid__row_head', function (ctx) {
            ctx.content([
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            name: 'mode'
                        },
                        content: "Mode"
                    },
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            name: 'number'
                        },
                        content: "Flight Number"
                    },
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            name: 'airport'
                        },
                        content: {
                                     dep: 'Arrival',
                                     arr: 'Departure'
                                 }[ctx.param('mode')] + " Airport"
                    },
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            name: 'airline'
                        },
                        content: "Airline"
                    },
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            name: 'airplane'
                        },
                        content: "Airplane"
                    },
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            size: 'time',
                            name: 'time'
                        },
                        content: {
                            tag: 'span',
                            cls: 'grid__cell-inner_time',
                            content: "Scheduled Time"
                        }
                    },
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            name: 'status'
                        },
                        content: "Status"
                    },
                    {
                        elem: 'cell',
                        elemMods: {
                            head: true,
                            name: 'delays'
                        },
                        content: "Delays (min)"
                    }
                ], true
            );
        }
    );

// end: ../../common.blocks/grid/__row/_head/grid__row_head.bh.js
// begin: ../../common.blocks/popup/__content/_main/popup__content_main_row.bh.js

    bh.match('popup__content_main_row', function (ctx, json) {
        if (!json.data) {
            return;
        }

        ctx.cls('popup__content_main').content([
            {
                cls: 'popup__content_main-inner',
                content: [
                    {
                        block: 'grid',
                        elem: 'row',
                        elemMods: {head: true},
                        mode: json.data.mode
                    },
                    {
                        block: 'grid',
                        elem: 'row',
                        elemMods: {content: true},
                        data: json.data
                    }
                ]
            },
        ], true);
    });

// end: ../../common.blocks/popup/__content/_main/popup__content_main_row.bh.js
// begin: ../../libs/bem-components/common.blocks/icon/icon.bh.js

    bh.match('icon', function(ctx, json) {
        var attrs = { 'aria-hidden' : 'true' },
            url = json.url;
        if(url) attrs.style = 'background-image:url(' + url + ')';
        ctx
            .tag('i')
            .attrs(attrs);
    });

// end: ../../libs/bem-components/common.blocks/icon/icon.bh.js
// begin: ../../libs/bem-components/common.blocks/popup/popup.bh.js

    bh.match('popup', function(ctx, json) {
        ctx.js({
            mainOffset : json.mainOffset,
            secondaryOffset : json.secondaryOffset,
            viewportOffset : json.viewportOffset,
            directions : json.directions,
            zIndexGroupLevel : json.zIndexGroupLevel
        });
    });

// end: ../../libs/bem-components/common.blocks/popup/popup.bh.js
// begin: ../../common.blocks/grid/__cell/grid__cell.bh.js

    bh.match('grid__cell', function (ctx) {
        ctx.content({
            tag: 'div',
            cls: 'grid__cell-inner',
            content: ctx.content()
        }, true);
    });

// end: ../../common.blocks/grid/__cell/grid__cell.bh.js
// begin: ../../common.blocks/grid/__cell/_format/grid__cell_format_airport.bh.js

    bh.match('grid__cell_format_airport', function (ctx) {
        var data = ctx.param('data');

        if (!data) {
            return;
        }

        ctx.content(data.replace(/Airport/, ''));
    });

// end: ../../common.blocks/grid/__cell/_format/grid__cell_format_airport.bh.js
// begin: ../../common.blocks/grid/__cell/_format/grid__cell_format_airline.bh.js

    bh.match('grid__cell_format_airline', function (ctx) {
        var data = ctx.param('data');

        if (!data) {
            return;
        }

        ctx
            .mix({block: 'i-bem'})
            .attr('data-bem', JSON.stringify({
                grid__cell_format_airline: {
                    name: data.name,
                    id: 'grid__cell_format_airline'
                }
            }))
            .js(true, true)
            .content({
                block: 'icon',
                cls: 'grid__cell_format_airline-logo',
                attrs: {'data-name': data.name},
                url: 'http://0.omg.io/wego/image/upload/c_fit,w_70,h_30/flights/airlines_rectangular/' +
                     data.fs + '.png'
            }
        );
    });

// end: ../../common.blocks/grid/__cell/_format/grid__cell_format_airline.bh.js
// begin: ../../common.blocks/grid/__cell/_format/grid__cell_format_time.bh.js

    bh.match('grid__cell_format_time', function (ctx) {
        var data = ctx.param('data');

        if (!data) {
            return;
        }

        ctx.content({
            tag: 'span',
            cls: 'grid__cell-inner_time',
            content: moment(data).format('DD.MM.YY HH:mm')
        });
    });

// end: ../../common.blocks/grid/__cell/_format/grid__cell_format_time.bh.js
// begin: ../../common.blocks/grid/__cell/_format/grid__cell_format_delays.bh.js

    bh.match('grid__cell_format_delays', function (ctx) {
        var data = ctx.param('data');

        if (!data) {
            ctx.content('–');
            return;
        }

        var content = [];

        ['departure', 'arrival'].forEach(function (mode) {
            if (data[mode + 'GateDelayMinutes']) {
                content.push(
                    {
                        block: 'icon',
                        cls: 'grid__cell_format_mode-link',
                        url: mode.slice(0, 3) + '.png'
                    },
                    {
                        tag: 'span',
                        cls: 'grid__cell_format_delays-minutes',
                        content: ': ' + data[mode + 'GateDelayMinutes']
                    }
                );
            }
        });

        ctx.content(content);
    });

// end: ../../common.blocks/grid/__cell/_format/grid__cell_format_delays.bh.js
// begin: ../../common.blocks/grid/__cell/_format/grid__cell_format_mode.bh.js

    bh.match('grid__cell_format_mode', function (ctx) {
        var data = ctx.param('data');

        if (!data) {
            return;
        }

        ctx.content({
            block: 'icon',
            cls: 'grid__cell_format_mode-link',
            url: data + '.png'
        });
    });

// end: ../../common.blocks/grid/__cell/_format/grid__cell_format_mode.bh.js
// begin: ../../common.blocks/grid/__content/grid__content.bh.js

    bh.match('grid__content', function (ctx, json) {
        ctx.content(
            (json.rows || [])
                .map(function (row) {
                    return {
                        elem: 'row',
                        elemMods: {content: true},
                        mix: [{block: 'i-bem'}],
                        attrs: {
                            'data-bem': JSON.stringify({
                                'grid__row_content': {
                                    data: row,
                                    id: 'row'
                                }
                            })
                        },
                        data: row
                    }
                })
                .concat([
                    {
                        block: 'popup',
                        mods: {
                            theme: 'islands',
                            target: 'position',
                            autoclosable: true
                        },
                        mix: {
                            block: 'popup',
                            mods: {main: 'row'}
                        }
                    },
                    {
                        block: 'popup',
                        mods: {
                            theme: 'islands',
                            target: 'anchor',
                            autoclosable: true
                        },
                        directions : ['right-center', 'bottom-center', 'top-center'],
                        mix: {
                            block: 'popup',
                            mods: {airline: true}
                        }
                    }
                ])
            , true
        );
    });

// end: ../../common.blocks/grid/__content/grid__content.bh.js
// begin: ../../common.blocks/grid/__row/_content/grid__row_content.bh.js

    bh.match('grid__row_content', function (ctx, json) {
        if (!json.data) {
            return;
        }
        ctx.content([
            {
                elem: 'cell',
                elemMods: {
                    format: 'mode',
                    name: 'mode',
                    content: true
                },
                data: json.data.mode
            },
            {
                elem: 'cell',
                elemMods: {
                    format: 'number',
                    name: 'number',
                    content: true
                },
                content: json.data.flightNumber
            },
            {
                elem: 'cell',
                elemMods: {
                    format: 'airport',
                    content: true,
                    name: 'airport'
                },
                data: json.data[{dep: 'arr',arr: 'dep'}[json.data.mode] + 'Airport']
            },
            {
                elem: 'cell',
                elemMods: {
                    format: 'airline',
                    content: true,
                    name: 'airline'
                },
                data: json.data.airline
            },
            {
                elem: 'cell',
                elemMods: {
                    format: 'airplane',
                    content: true,
                    name: 'airplane'
                },
                content: json.data.equipment
            },
            {
                elem: 'cell',
                elemMods: {
                    format: 'time',
                    content: true,
                    name: 'time'
                },
                data: json.data[json.data.mode + 'Time']
            },
            {
                elem: 'cell',
                elemMods: {
                    format: 'status',
                    content: true,
                    name: 'status'
                },
                content: json.data.status
            },
            {
                elem: 'cell',
                elemMods: {
                    format: 'delays',
                    content: true,
                    name: 'delays'
                },
                data: json.data.delays
            }
        ], true);
    });

// end: ../../common.blocks/grid/__row/_content/grid__row_content.bh.js
provide(bh);
});
modules.define('BEMHTML', ["bh"], function(provide, bh) {
provide(bh);
});

/* begin: ../../libs/bem-core/common.blocks/i-bem/i-bem.vanilla.js */
/**
 * @module i-bem
 */

modules.define(
    'i-bem',
    [
        'i-bem__internal',
        'inherit',
        'identify',
        'next-tick',
        'objects',
        'functions',
        'events'
    ],
    function(
        provide,
        INTERNAL,
        inherit,
        identify,
        nextTick,
        objects,
        functions,
        events) {

var undef,

    MOD_DELIM = INTERNAL.MOD_DELIM,
    ELEM_DELIM = INTERNAL.ELEM_DELIM,

    /**
     * Storage for block init functions
     * @private
     * @type Array
     */
    initFns = [],

    /**
     * Storage for block declarations (hash by block name)
     * @private
     * @type Object
     */
    blocks = {};

/**
 * Builds the name of the handler method for setting a modifier
 * @param {String} prefix
 * @param {String} modName Modifier name
 * @param {String} modVal Modifier value
 * @param {String} [elemName] Element name
 * @returns {String}
 */
function buildModFnName(prefix, modName, modVal, elemName) {
    return '__' + prefix +
        (elemName? '__elem_' + elemName : '') +
       '__mod' +
       (modName? '_' + modName : '') +
       (modVal? '_' + modVal : '');
}

/**
 * Transforms a hash of modifier handlers to methods
 * @param {String} prefix
 * @param {Object} modFns
 * @param {Object} props
 * @param {String} [elemName]
 */
function modFnsToProps(prefix, modFns, props, elemName) {
    if(functions.isFunction(modFns)) {
        props[buildModFnName(prefix, '*', '*', elemName)] = modFns;
    } else {
        var modName, modVal, modFn;
        for(modName in modFns) {
            if(modFns.hasOwnProperty(modName)) {
                modFn = modFns[modName];
                if(functions.isFunction(modFn)) {
                    props[buildModFnName(prefix, modName, '*', elemName)] = modFn;
                } else {
                    for(modVal in modFn) {
                        if(modFn.hasOwnProperty(modVal)) {
                            props[buildModFnName(prefix, modName, modVal, elemName)] = modFn[modVal];
                        }
                    }
                }
            }
        }
    }
}

function buildCheckMod(modName, modVal) {
    return modVal?
        Array.isArray(modVal)?
            function(block) {
                var i = 0, len = modVal.length;
                while(i < len)
                    if(block.hasMod(modName, modVal[i++]))
                        return true;
                return false;
            } :
            function(block) {
                return block.hasMod(modName, modVal);
            } :
        function(block) {
            return block.hasMod(modName);
        };
}

function convertModHandlersToMethods(props) {
    if(props.beforeSetMod) {
        modFnsToProps('before', props.beforeSetMod, props);
        delete props.beforeSetMod;
    }

    if(props.onSetMod) {
        modFnsToProps('after', props.onSetMod, props);
        delete props.onSetMod;
    }

    var elemName;
    if(props.beforeElemSetMod) {
        for(elemName in props.beforeElemSetMod) {
            if(props.beforeElemSetMod.hasOwnProperty(elemName)) {
                modFnsToProps('before', props.beforeElemSetMod[elemName], props, elemName);
            }
        }
        delete props.beforeElemSetMod;
    }

    if(props.onElemSetMod) {
        for(elemName in props.onElemSetMod) {
            if(props.onElemSetMod.hasOwnProperty(elemName)) {
                modFnsToProps('after', props.onElemSetMod[elemName], props, elemName);
            }
        }
        delete props.onElemSetMod;
    }
}

/**
 * @class BEM
 * @description Base block for creating BEM blocks
 * @augments events:Emitter
 * @exports
 */
var BEM = inherit(events.Emitter, /** @lends BEM.prototype */ {
    /**
     * @constructor
     * @private
     * @param {Object} mods Block modifiers
     * @param {Object} params Block parameters
     * @param {Boolean} [initImmediately=true]
     */
    __constructor : function(mods, params, initImmediately) {
        /**
         * Cache of block modifiers
         * @member {Object}
         * @private
         */
        this._modCache = mods || {};

        /**
         * Current modifiers in the stack
         * @member {Object}
         * @private
         */
        this._processingMods = {};

        /**
         * Block parameters, taking into account the defaults
         * @member {Object}
         * @readonly
         */
        this.params = objects.extend(this.getDefaultParams(), params);

        initImmediately !== false?
            this._init() :
            initFns.push(this._init, this);
    },

    /**
     * Initializes the block
     * @private
     */
    _init : function() {
        return this.setMod('js', 'inited');
    },

    /**
     * Adds an event handler
     * @param {String|Object} e Event type
     * @param {Object} [data] Additional data that the handler gets as e.data
     * @param {Function} fn Handler
     * @param {Object} [ctx] Handler context
     * @returns {BEM} this
     */
    on : function(e, data, fn, ctx) {
        if(typeof e === 'object' && (functions.isFunction(data) || functions.isFunction(fn))) { // mod change event
            e = this.__self._buildModEventName(e);
        }

        return this.__base.apply(this, arguments);
    },

    /**
     * Removes event handler or handlers
     * @param {String|Object} [e] Event type
     * @param {Function} [fn] Handler
     * @param {Object} [ctx] Handler context
     * @returns {BEM} this
     */
    un : function(e, fn, ctx) {
        if(typeof e === 'object' && functions.isFunction(fn)) { // mod change event
            e = this.__self._buildModEventName(e);
        }

        return this.__base.apply(this, arguments);
    },

    /**
     * Executes the block's event handlers and live event handlers
     * @protected
     * @param {String} e Event name
     * @param {Object} [data] Additional information
     * @returns {BEM} this
     */
    emit : function(e, data) {
        var isModJsEvent = false;
        if(typeof e === 'object' && !(e instanceof events.Event)) {
            isModJsEvent = e.modName === 'js';
            e = this.__self._buildModEventName(e);
        }

        if(isModJsEvent || this.hasMod('js', 'inited')) {
            this.__base(e = this._buildEvent(e), data);
            this._ctxEmit(e, data);
        }

        return this;
    },

    _ctxEmit : function(e, data) {
        this.__self.emit(e, data);
    },

    /**
     * Builds event
     * @private
     * @param {String|events:Event} e
     * @returns {events:Event}
     */
    _buildEvent : function(e) {
        typeof e === 'string'?
            e = new events.Event(e, this) :
            e.target || (e.target = this);

        return e;
    },

    /**
     * Checks whether a block or nested element has a modifier
     * @param {Object} [elem] Nested element
     * @param {String} modName Modifier name
     * @param {String|Boolean} [modVal] Modifier value. If defined and not of type String or Boolean, it is casted to String
     * @returns {Boolean}
     */
    hasMod : function(elem, modName, modVal) {
        var len = arguments.length,
            invert = false;

        if(len === 1) {
            modVal = '';
            modName = elem;
            elem = undef;
            invert = true;
        } else if(len === 2) {
            if(typeof elem === 'string') {
                modVal = modName;
                modName = elem;
                elem = undef;
            } else {
                modVal = '';
                invert = true;
            }
        }

        var typeModVal = typeof modVal;
        typeModVal === 'string' ||
            typeModVal === 'boolean' ||
            typeModVal === 'undefined' || (modVal = modVal.toString());

        var res = this.getMod(elem, modName) === modVal;
        return invert? !res : res;
    },

    /**
     * Returns the value of the modifier of the block/nested element
     * @param {Object} [elem] Nested element
     * @param {String} modName Modifier name
     * @returns {String} Modifier value
     */
    getMod : function(elem, modName) {
        var type = typeof elem;
        if(type === 'string' || type === 'undefined') { // elem either omitted or undefined
            modName = elem || modName;
            var modCache = this._modCache;
            return modName in modCache?
                modCache[modName] || '' :
                modCache[modName] = this._extractModVal(modName);
        }

        return this._getElemMod(modName, elem);
    },

    /**
     * Returns the value of the modifier of the nested element
     * @private
     * @param {String} modName Modifier name
     * @param {Object} elem Nested element
     * @param {Object} [elemName] Nested element name
     * @returns {String} Modifier value
     */
    _getElemMod : function(modName, elem, elemName) {
        return this._extractModVal(modName, elem, elemName);
    },

    /**
     * Returns values of modifiers of the block/nested element
     * @param {Object} [elem] Nested element
     * @param {String} [...modNames] Modifier names
     * @returns {Object} Hash of modifier values
     */
    getMods : function(elem) {
        var hasElem = elem && typeof elem !== 'string',
            modNames = [].slice.call(arguments, hasElem? 1 : 0),
            res = this._extractMods(modNames, hasElem? elem : undef);

        if(!hasElem) { // caching
            modNames.length?
                modNames.forEach(function(name) {
                    this._modCache[name] = res[name];
                }, this) :
                this._modCache = res;
        }

        return res;
    },

    /**
     * Sets the modifier for a block/nested element
     * @param {Object} [elem] Nested element
     * @param {String} modName Modifier name
     * @param {String|Boolean} [modVal=true] Modifier value. If not of type String or Boolean, it is casted to String
     * @returns {BEM} this
     */
    setMod : function(elem, modName, modVal) {
        if(typeof modVal === 'undefined') {
            if(typeof elem === 'string') { // if no elem
                modVal = typeof modName === 'undefined'?
                    true :  // e.g. setMod('focused')
                    modName; // e.g. setMod('js', 'inited')
                modName = elem;
                elem = undef;
            } else { // if elem
                modVal = true; // e.g. setMod(elem, 'focused')
            }
        }

        if(!elem || elem[0]) {
            if(modVal === false) {
                modVal = '';
            } else if(typeof modVal !== 'boolean') {
                modVal = modVal.toString();
            }

            var modId = (elem && elem[0]? identify(elem[0]) : '') + '_' + modName;

            if(this._processingMods[modId])
                return this;

            var elemName,
                curModVal = elem?
                    this._getElemMod(modName, elem, elemName = this.__self._extractElemNameFrom(elem)) :
                    this.getMod(modName);

            if(curModVal === modVal)
                return this;

            this._processingMods[modId] = true;

            var needSetMod = true,
                modFnParams = [modName, modVal, curModVal];

            elem && modFnParams.unshift(elem);

            var modVars = [['*', '*'], [modName, '*'], [modName, modVal]],
                prefixes = ['before', 'after'],
                i = 0, prefix, j, modVar;

            while(prefix = prefixes[i++]) {
                j = 0;
                while(modVar = modVars[j++]) {
                    if(this._callModFn(prefix, elemName, modVar[0], modVar[1], modFnParams) === false) {
                        needSetMod = false;
                        break;
                    }
                }

                if(!needSetMod) break;

                if(prefix === 'before') {
                    elem || (this._modCache[modName] = modVal); // cache only block mods
                    this._onSetMod(modName, modVal, curModVal, elem, elemName);
                }
            }

            this._processingMods[modId] = null;
            needSetMod && this._emitModChangeEvents(modName, modVal, curModVal, elem, elemName);
        }

        return this;
    },

    /**
     * Function after successfully changing the modifier of the block/nested element
     * @protected
     * @param {String} modName Modifier name
     * @param {String} modVal Modifier value
     * @param {String} oldModVal Old modifier value
     * @param {Object} [elem] Nested element
     * @param {String} [elemName] Element name
     */
    _onSetMod : function(modName, modVal, oldModVal, elem, elemName) {},

    _emitModChangeEvents : function(modName, modVal, oldModVal, elem, elemName) {
        var eventData = { modName : modName, modVal : modVal, oldModVal : oldModVal };
        elem && (eventData.elem = elem);
        this
            .emit({ modName : modName, modVal : '*', elem : elemName }, eventData)
            .emit({ modName : modName, modVal : modVal, elem : elemName }, eventData);
    },

    /**
     * Sets a modifier for a block/nested element, depending on conditions.
     * If the condition parameter is passed: when true, modVal1 is set; when false, modVal2 is set.
     * If the condition parameter is not passed: modVal1 is set if modVal2 was set, or vice versa.
     * @param {Object} [elem] Nested element
     * @param {String} modName Modifier name
     * @param {String} modVal1 First modifier value
     * @param {String} [modVal2] Second modifier value
     * @param {Boolean} [condition] Condition
     * @returns {BEM} this
     */
    toggleMod : function(elem, modName, modVal1, modVal2, condition) {
        if(typeof elem === 'string') { // if this is a block
            condition = modVal2;
            modVal2 = modVal1;
            modVal1 = modName;
            modName = elem;
            elem = undef;
        }

        if(typeof modVal1 === 'undefined') { // boolean mod
            modVal1 = true;
        }

        if(typeof modVal2 === 'undefined') {
            modVal2 = '';
        } else if(typeof modVal2 === 'boolean') {
            condition = modVal2;
            modVal2 = '';
        }

        var modVal = this.getMod(elem, modName);
        (modVal === modVal1 || modVal === modVal2) &&
            this.setMod(
                elem,
                modName,
                typeof condition === 'boolean'?
                    (condition? modVal1 : modVal2) :
                    this.hasMod(elem, modName, modVal1)? modVal2 : modVal1);

        return this;
    },

    /**
     * Removes a modifier from a block/nested element
     * @protected
     * @param {Object} [elem] Nested element
     * @param {String} modName Modifier name
     * @returns {BEM} this
     */
    delMod : function(elem, modName) {
        if(!modName) {
            modName = elem;
            elem = undef;
        }

        return this.setMod(elem, modName, '');
    },

    /**
     * Executes handlers for setting modifiers
     * @private
     * @param {String} prefix
     * @param {String} elemName Element name
     * @param {String} modName Modifier name
     * @param {String} modVal Modifier value
     * @param {Array} modFnParams Handler parameters
     */
    _callModFn : function(prefix, elemName, modName, modVal, modFnParams) {
        var modFnName = buildModFnName(prefix, modName, modVal, elemName);
        return this[modFnName]?
           this[modFnName].apply(this, modFnParams) :
           undef;
    },

    /**
     * Retrieves the value of the modifier
     * @private
     * @param {String} modName Modifier name
     * @param {Object} [elem] Element
     * @returns {String} Modifier value
     */
    _extractModVal : function(modName, elem) {
        return '';
    },

    /**
     * Retrieves name/value for a list of modifiers
     * @private
     * @param {Array} modNames Names of modifiers
     * @param {Object} [elem] Element
     * @returns {Object} Hash of modifier values by name
     */
    _extractMods : function(modNames, elem) {
        return {};
    },

    /**
     * Returns a block's default parameters
     * @protected
     * @returns {Object}
     */
    getDefaultParams : function() {
        return {};
    },

    /**
     * Deletes a block
     * @private
     */
    _destruct : function() {
        this.delMod('js');
    },

    /**
     * Executes given callback on next turn eventloop in block's context
     * @protected
     * @param {Function} fn callback
     * @returns {BEM} this
     */
    nextTick : function(fn) {
        var _this = this;
        nextTick(function() {
            _this.hasMod('js', 'inited') && fn.call(_this);
        });
        return this;
    }
}, /** @lends BEM */{

    _name : 'i-bem',

    /**
     * Storage for block declarations (hash by block name)
     * @type Object
     */
    blocks : blocks,

    /**
     * Declares blocks and creates a block class
     * @param {String|Object} decl Block name (simple syntax) or description
     * @param {String} decl.block|decl.name Block name
     * @param {String} [decl.baseBlock] Name of the parent block
     * @param {Array} [decl.baseMix] Mixed block names
     * @param {String} [decl.modName] Modifier name
     * @param {String|Array} [decl.modVal] Modifier value
     * @param {Object} [props] Methods
     * @param {Object} [staticProps] Static methods
     * @returns {Function}
     */
    decl : function(decl, props, staticProps) {
        // string as block
        typeof decl === 'string' && (decl = { block : decl });
        // inherit from itself
        if(arguments.length <= 2 &&
                typeof decl === 'object' &&
                (!decl || (typeof decl.block !== 'string' && typeof decl.modName !== 'string'))) {
            staticProps = props;
            props = decl;
            decl = {};
        }
        typeof decl.block === 'undefined' && (decl.block = this.getName());

        var baseBlock;
        if(typeof decl.baseBlock === 'undefined') {
            baseBlock = blocks[decl.block] || this;
        } else if(typeof decl.baseBlock === 'string') {
            baseBlock = blocks[decl.baseBlock];
            if(!baseBlock)
                throw('baseBlock "' + decl.baseBlock + '" for "' + decl.block + '" is undefined');
        } else {
            baseBlock = decl.baseBlock;
        }

        convertModHandlersToMethods(props || (props = {}));

        if(decl.modName) {
            var checkMod = buildCheckMod(decl.modName, decl.modVal);
            objects.each(props, function(prop, name) {
                functions.isFunction(prop) &&
                    (props[name] = function() {
                        var method;
                        if(checkMod(this)) {
                            method = prop;
                        } else {
                            var baseMethod = baseBlock.prototype[name];
                            baseMethod && baseMethod !== prop &&
                                (method = this.__base);
                        }
                        return method?
                            method.apply(this, arguments) :
                            undef;
                    });
            });
        }

        if(staticProps && typeof staticProps.live === 'boolean') {
            var live = staticProps.live;
            staticProps.live = function() {
                return live;
            };
        }

        var block, baseBlocks = baseBlock;
        if(decl.baseMix) {
            baseBlocks = [baseBlocks];
            decl.baseMix.forEach(function(mixedBlock) {
                if(!blocks[mixedBlock]) {
                    throw('mix block "' + mixedBlock + '" for "' + decl.block + '" is undefined');
                }
                baseBlocks.push(blocks[mixedBlock]);
            });
        }

        if(decl.block === baseBlock.getName()) {
            // makes a new "live" if the old one was already executed
            (block = inherit.self(baseBlocks, props, staticProps))._processLive(true);
        } else {
            (block = blocks[decl.block] = inherit(baseBlocks, props, staticProps))._name = decl.block;
            delete block._liveInitable;
        }

        return block;
    },

    declMix : function(block, props, staticProps) {
        convertModHandlersToMethods(props || (props = {}));
        return blocks[block] = inherit(props, staticProps);
    },

    /**
     * Processes a block's live properties
     * @private
     * @param {Boolean} [heedLive=false] Whether to take into account that the block already processed its live properties
     * @returns {Boolean} Whether the block is a live block
     */
    _processLive : function(heedLive) {
        return false;
    },

    /**
     * Factory method for creating an instance of the block named
     * @param {String|Object} block Block name or description
     * @param {Object} [params] Block parameters
     * @returns {BEM}
     */
    create : function(block, params) {
        typeof block === 'string' && (block = { block : block });

        return new blocks[block.block](block.mods, params);
    },

    /**
     * Returns the name of the current block
     * @returns {String}
     */
    getName : function() {
        return this._name;
    },

    /**
     * Adds an event handler
     * @param {String|Object} e Event type
     * @param {Object} [data] Additional data that the handler gets as e.data
     * @param {Function} fn Handler
     * @param {Object} [ctx] Handler context
     * @returns {Function} this
     */
    on : function(e, data, fn, ctx) {
        if(typeof e === 'object' && (functions.isFunction(data) || functions.isFunction(fn))) { // mod change event
            e = this._buildModEventName(e);
        }

        return this.__base.apply(this, arguments);
    },

    /**
     * Removes event handler or handlers
     * @param {String|Object} [e] Event type
     * @param {Function} [fn] Handler
     * @param {Object} [ctx] Handler context
     * @returns {Function} this
     */
    un : function(e, fn, ctx) {
        if(typeof e === 'object' && functions.isFunction(fn)) { // mod change event
            e = this._buildModEventName(e);
        }

        return this.__base.apply(this, arguments);
    },

    _buildModEventName : function(modEvent) {
        var res = MOD_DELIM + modEvent.modName + MOD_DELIM + (modEvent.modVal === false? '' : modEvent.modVal);
        modEvent.elem && (res = ELEM_DELIM + modEvent.elem + res);
        return res;
    },

    /**
     * Retrieves the name of an element nested in a block
     * @private
     * @param {Object} elem Nested element
     * @returns {String|undefined}
     */
    _extractElemNameFrom : function(elem) {},

    /**
     * Executes the block init functions
     * @private
     */
    _runInitFns : function() {
        if(initFns.length) {
            var fns = initFns,
                fn, i = 0;

            initFns = [];
            while(fn = fns[i]) {
                fn.call(fns[i + 1]);
                i += 2;
            }
        }
    }
});

provide(BEM);

});

/* end: ../../libs/bem-core/common.blocks/i-bem/i-bem.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/i-bem/__internal/i-bem__internal.vanilla.js */
/**
 * @module i-bem__internal
 */

modules.define('i-bem__internal', function(provide) {

var undef,
    /**
     * Separator for modifiers and their values
     * @const
     * @type String
     */
    MOD_DELIM = '_',

    /**
     * Separator between names of a block and a nested element
     * @const
     * @type String
     */
    ELEM_DELIM = '__',

    /**
     * Pattern for acceptable element and modifier names
     * @const
     * @type String
     */
    NAME_PATTERN = '[a-zA-Z0-9-]+';

function isSimple(obj) {
    var typeOf = typeof obj;
    return typeOf === 'string' || typeOf === 'number' || typeOf === 'boolean';
}

function buildModPostfix(modName, modVal) {
    var res = '';
    /* jshint eqnull: true */
    if(modVal != null && modVal !== false) {
        res += MOD_DELIM + modName;
        modVal !== true && (res += MOD_DELIM + modVal);
    }
    return res;
}

function buildBlockClass(name, modName, modVal) {
    return name + buildModPostfix(modName, modVal);
}

function buildElemClass(block, name, modName, modVal) {
    return buildBlockClass(block, undef, undef) +
        ELEM_DELIM + name +
        buildModPostfix(modName, modVal);
}

provide(/** @exports */{
    NAME_PATTERN : NAME_PATTERN,

    MOD_DELIM : MOD_DELIM,
    ELEM_DELIM : ELEM_DELIM,

    buildModPostfix : buildModPostfix,

    /**
     * Builds the class of a block or element with a modifier
     * @param {String} block Block name
     * @param {String} [elem] Element name
     * @param {String} [modName] Modifier name
     * @param {String|Number} [modVal] Modifier value
     * @returns {String} Class
     */
    buildClass : function(block, elem, modName, modVal) {
        if(isSimple(modName)) {
            if(!isSimple(modVal)) {
                modVal = modName;
                modName = elem;
                elem = undef;
            }
        } else if(typeof modName !== 'undefined') {
            modName = undef;
        } else if(elem && typeof elem !== 'string') {
            elem = undef;
        }

        if(!(elem || modName)) { // optimization for simple case
            return block;
        }

        return elem?
            buildElemClass(block, elem, modName, modVal) :
            buildBlockClass(block, modName, modVal);
    },

    /**
     * Builds full classes for a buffer or element with modifiers
     * @param {String} block Block name
     * @param {String} [elem] Element name
     * @param {Object} [mods] Modifiers
     * @returns {String} Class
     */
    buildClasses : function(block, elem, mods) {
        if(elem && typeof elem !== 'string') {
            mods = elem;
            elem = undef;
        }

        var res = elem?
            buildElemClass(block, elem, undef, undef) :
            buildBlockClass(block, undef, undef);

        if(mods) {
            for(var modName in mods) {
                if(mods.hasOwnProperty(modName) && mods[modName]) {
                    res += ' ' + (elem?
                        buildElemClass(block, elem, modName, mods[modName]) :
                        buildBlockClass(block, modName, mods[modName]));
                }
            }
        }

        return res;
    }
});

});

/* end: ../../libs/bem-core/common.blocks/i-bem/__internal/i-bem__internal.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/inherit/inherit.vanilla.js */
/**
 * @module inherit
 * @version 2.2.1
 * @author Filatov Dmitry <dfilatov@yandex-team.ru>
 * @description This module provides some syntax sugar for "class" declarations, constructors, mixins, "super" calls and static members.
 */

(function(global) {

var hasIntrospection = (function(){'_';}).toString().indexOf('_') > -1,
    emptyBase = function() {},
    hasOwnProperty = Object.prototype.hasOwnProperty,
    objCreate = Object.create || function(ptp) {
        var inheritance = function() {};
        inheritance.prototype = ptp;
        return new inheritance();
    },
    objKeys = Object.keys || function(obj) {
        var res = [];
        for(var i in obj) {
            hasOwnProperty.call(obj, i) && res.push(i);
        }
        return res;
    },
    extend = function(o1, o2) {
        for(var i in o2) {
            hasOwnProperty.call(o2, i) && (o1[i] = o2[i]);
        }

        return o1;
    },
    toStr = Object.prototype.toString,
    isArray = Array.isArray || function(obj) {
        return toStr.call(obj) === '[object Array]';
    },
    isFunction = function(obj) {
        return toStr.call(obj) === '[object Function]';
    },
    noOp = function() {},
    needCheckProps = true,
    testPropObj = { toString : '' };

for(var i in testPropObj) { // fucking ie hasn't toString, valueOf in for
    testPropObj.hasOwnProperty(i) && (needCheckProps = false);
}

var specProps = needCheckProps? ['toString', 'valueOf'] : null;

function getPropList(obj) {
    var res = objKeys(obj);
    if(needCheckProps) {
        var specProp, i = 0;
        while(specProp = specProps[i++]) {
            obj.hasOwnProperty(specProp) && res.push(specProp);
        }
    }

    return res;
}

function override(base, res, add) {
    var addList = getPropList(add),
        j = 0, len = addList.length,
        name, prop;
    while(j < len) {
        if((name = addList[j++]) === '__self') {
            continue;
        }
        prop = add[name];
        if(isFunction(prop) &&
                (!hasIntrospection || prop.toString().indexOf('.__base') > -1)) {
            res[name] = (function(name, prop) {
                var baseMethod = base[name]?
                        base[name] :
                        name === '__constructor'? // case of inheritance from plane function
                            res.__self.__parent :
                            noOp;
                return function() {
                    var baseSaved = this.__base;
                    this.__base = baseMethod;
                    var res = prop.apply(this, arguments);
                    this.__base = baseSaved;
                    return res;
                };
            })(name, prop);
        } else {
            res[name] = prop;
        }
    }
}

function applyMixins(mixins, res) {
    var i = 1, mixin;
    while(mixin = mixins[i++]) {
        res?
            isFunction(mixin)?
                inherit.self(res, mixin.prototype, mixin) :
                inherit.self(res, mixin) :
            res = isFunction(mixin)?
                inherit(mixins[0], mixin.prototype, mixin) :
                inherit(mixins[0], mixin);
    }
    return res || mixins[0];
}

/**
* Creates class
* @exports
* @param {Function|Array} [baseClass|baseClassAndMixins] class (or class and mixins) to inherit from
* @param {Object} prototypeFields
* @param {Object} [staticFields]
* @returns {Function} class
*/
function inherit() {
    var args = arguments,
        withMixins = isArray(args[0]),
        hasBase = withMixins || isFunction(args[0]),
        base = hasBase? withMixins? applyMixins(args[0]) : args[0] : emptyBase,
        props = args[hasBase? 1 : 0] || {},
        staticProps = args[hasBase? 2 : 1],
        res = props.__constructor || (hasBase && base.prototype.__constructor)?
            function() {
                return this.__constructor.apply(this, arguments);
            } :
            hasBase?
                function() {
                    return base.apply(this, arguments);
                } :
                function() {};

    if(!hasBase) {
        res.prototype = props;
        res.prototype.__self = res.prototype.constructor = res;
        return extend(res, staticProps);
    }

    extend(res, base);

    res.__parent = base;

    var basePtp = base.prototype,
        resPtp = res.prototype = objCreate(basePtp);

    resPtp.__self = resPtp.constructor = res;

    props && override(basePtp, resPtp, props);
    staticProps && override(base, res, staticProps);

    return res;
}

inherit.self = function() {
    var args = arguments,
        withMixins = isArray(args[0]),
        base = withMixins? applyMixins(args[0], args[0][0]) : args[0],
        props = args[1],
        staticProps = args[2],
        basePtp = base.prototype;

    props && override(basePtp, basePtp, props);
    staticProps && override(base, base, staticProps);

    return base;
};

var defineAsGlobal = true;
if(typeof exports === 'object') {
    module.exports = inherit;
    defineAsGlobal = false;
}

if(typeof modules === 'object') {
    modules.define('inherit', function(provide) {
        provide(inherit);
    });
    defineAsGlobal = false;
}

if(typeof define === 'function') {
    define(function(require, exports, module) {
        module.exports = inherit;
    });
    defineAsGlobal = false;
}

defineAsGlobal && (global.inherit = inherit);

})(this);

/* end: ../../libs/bem-core/common.blocks/inherit/inherit.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/identify/identify.vanilla.js */
/**
 * @module identify
 */

modules.define('identify', function(provide) {

var counter = 0,
    expando = '__' + (+new Date),
    get = function() {
        return 'uniq' + (++counter);
    };

provide(
    /**
     * Makes unique ID
     * @exports
     * @param {Object} obj Object that needs to be identified
     * @param {Boolean} [onlyGet=false] Return a unique value only if it had already been assigned before
     * @returns {String} ID
     */
    function(obj, onlyGet) {
        if(!obj) return get();

        var key = 'uniqueID' in obj? 'uniqueID' : expando; // Use when possible native uniqueID for elements in IE

        return onlyGet || key in obj?
            obj[key] :
            obj[key] = get();
    }
);

});

/* end: ../../libs/bem-core/common.blocks/identify/identify.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/next-tick/next-tick.vanilla.js */
/**
 * @module next-tick
 */

modules.define('next-tick', function(provide) {

/**
 * Executes given function on next tick.
 * @exports
 * @type Function
 * @param {Function} fn
 */

var global = this.global,
    fns = [],
    enqueueFn = function(fn) {
        return fns.push(fn) === 1;
    },
    callFns = function() {
        var fnsToCall = fns, i = 0, len = fns.length;
        fns = [];
        while(i < len) {
            fnsToCall[i++]();
        }
    };

    /* global process */
    if(typeof process === 'object' && process.nextTick) { // nodejs
        return provide(function(fn) {
            enqueueFn(fn) && process.nextTick(callFns);
        });
    }

    if(global.setImmediate) { // ie10
        return provide(function(fn) {
            enqueueFn(fn) && global.setImmediate(callFns);
        });
    }

    if(global.postMessage) { // modern browsers
        var isPostMessageAsync = true;
        if(global.attachEvent) {
            var checkAsync = function() {
                    isPostMessageAsync = false;
                };
            global.attachEvent('onmessage', checkAsync);
            global.postMessage('__checkAsync', '*');
            global.detachEvent('onmessage', checkAsync);
        }

        if(isPostMessageAsync) {
            var msg = '__nextTick' + (+new Date),
                onMessage = function(e) {
                    if(e.data === msg) {
                        e.stopPropagation && e.stopPropagation();
                        callFns();
                    }
                };

            global.addEventListener?
                global.addEventListener('message', onMessage, true) :
                global.attachEvent('onmessage', onMessage);

            return provide(function(fn) {
                enqueueFn(fn) && global.postMessage(msg, '*');
            });
        }
    }

    var doc = global.document;
    if('onreadystatechange' in doc.createElement('script')) { // ie6-ie8
        var head = doc.getElementsByTagName('head')[0],
            createScript = function() {
                var script = doc.createElement('script');
                script.onreadystatechange = function() {
                    script.parentNode.removeChild(script);
                    script = script.onreadystatechange = null;
                    callFns();
                };
                head.appendChild(script);
            };

        return provide(function(fn) {
            enqueueFn(fn) && createScript();
        });
    }

    provide(function(fn) { // old browsers
        enqueueFn(fn) && global.setTimeout(callFns, 0);
    });
});

/* end: ../../libs/bem-core/common.blocks/next-tick/next-tick.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/objects/objects.vanilla.js */
/**
 * @module objects
 * @description A set of helpers to work with JavaScript objects
 */

modules.define('objects', function(provide) {

var hasOwnProp = Object.prototype.hasOwnProperty;

provide(/** @exports */{
    /**
     * Extends a given target by
     * @param {Object} target object to extend
     * @param {Object} source
     * @returns {Object}
     */
    extend : function(target, source) {
        (typeof target !== 'object' || target === null) && (target = {});

        for(var i = 1, len = arguments.length; i < len; i++) {
            var obj = arguments[i];
            if(obj) {
                for(var key in obj) {
                    hasOwnProp.call(obj, key) && (target[key] = obj[key]);
                }
            }
        }

        return target;
    },

    /**
     * Check whether a given object is empty (contains no enumerable properties)
     * @param {Object} obj
     * @returns {Boolean}
     */
    isEmpty : function(obj) {
        for(var key in obj) {
            if(hasOwnProp.call(obj, key)) {
                return false;
            }
        }

        return true;
    },

    /**
     * Generic iterator function over object
     * @param {Object} obj object to iterate
     * @param {Function} fn callback
     * @param {Object} [ctx] callbacks's context
     */
    each : function(obj, fn, ctx) {
        for(var key in obj) {
            if(hasOwnProp.call(obj, key)) {
                ctx? fn.call(ctx, obj[key], key) : fn(obj[key], key);
            }
        }
    }
});

});

/* end: ../../libs/bem-core/common.blocks/objects/objects.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/functions/functions.vanilla.js */
/**
 * @module functions
 * @description A set of helpers to work with JavaScript functions
 */

modules.define('functions', function(provide) {

var toStr = Object.prototype.toString;

provide(/** @exports */{
    /**
     * Checks whether a given object is function
     * @param {*} obj
     * @returns {Boolean}
     */
    isFunction : function(obj) {
        return toStr.call(obj) === '[object Function]';
    },

    /**
     * Empty function
     */
    noop : function() {}
});

});

/* end: ../../libs/bem-core/common.blocks/functions/functions.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/events/events.vanilla.js */
/**
 * @module events
 */

modules.define(
    'events',
    ['identify', 'inherit', 'functions'],
    function(provide, identify, inherit, functions) {

var undef,
    storageExpando = '__' + (+new Date) + 'storage',
    getFnId = function(fn, ctx) {
        return identify(fn) + (ctx? identify(ctx) : '');
    },

    /**
     * @class Event
     * @exports events:Event
     */
    Event = inherit(/** @lends Event.prototype */{
        /**
         * @constructor
         * @param {String} type
         * @param {Object} target
         */
        __constructor : function(type, target) {
            /**
             * Type
             * @member {String} Event
             */
            this.type = type;

            /**
             * Target
             * @member {String} Event
             */
            this.target = target;

            /**
             * Result
             * @member {*}
             */
            this.result = undef;

            /**
             * Data
             * @member {*}
             */
            this.data = undef;

            this._isDefaultPrevented = false;
            this._isPropagationStopped = false;
        },

        /**
         * Prevents default action
         */
        preventDefault : function() {
            this._isDefaultPrevented = true;
        },

        /**
         * Returns whether is default action prevented
         * @returns {Boolean}
         */
        isDefaultPrevented : function() {
            return this._isDefaultPrevented;
        },

        /**
         * Stops propagation
         */
        stopPropagation : function() {
            this._isPropagationStopped = true;
        },

        /**
         * Returns whether is propagation stopped
         * @returns {Boolean}
         */
        isPropagationStopped : function() {
            return this._isPropagationStopped;
        }
    }),

    /**
     * @lends Emitter
     * @lends Emitter.prototype
     */
    EmitterProps = {
        /**
         * Adds an event handler
         * @param {String} e Event type
         * @param {Object} [data] Additional data that the handler gets as e.data
         * @param {Function} fn Handler
         * @param {Object} [ctx] Handler context
         * @returns {Emitter} this
         */
        on : function(e, data, fn, ctx, _special) {
            if(typeof e === 'string') {
                if(functions.isFunction(data)) {
                    ctx = fn;
                    fn = data;
                    data = undef;
                }

                var id = getFnId(fn, ctx),
                    storage = this[storageExpando] || (this[storageExpando] = {}),
                    eventTypes = e.split(' '), eventType,
                    i = 0, list, item,
                    eventStorage;

                while(eventType = eventTypes[i++]) {
                    eventStorage = storage[eventType] || (storage[eventType] = { ids : {}, list : {} });
                    if(!(id in eventStorage.ids)) {
                        list = eventStorage.list;
                        item = { fn : fn, data : data, ctx : ctx, special : _special };
                        if(list.last) {
                            list.last.next = item;
                            item.prev = list.last;
                        } else {
                            list.first = item;
                        }
                        eventStorage.ids[id] = list.last = item;
                    }
                }
            } else {
                for(var key in e) {
                    e.hasOwnProperty(key) && this.on(key, e[key], data, _special);
                }
            }

            return this;
        },

        /**
         * Adds a one time handler for the event.
         * Handler is executed only the next time the event is fired, after which it is removed.
         * @param {String} e Event type
         * @param {Object} [data] Additional data that the handler gets as e.data
         * @param {Function} fn Handler
         * @param {Object} [ctx] Handler context
         * @returns {Emitter} this
         */
        once : function(e, data, fn, ctx) {
            return this.on(e, data, fn, ctx, { once : true });
        },

        /**
         * Removes event handler or handlers
         * @param {String} [e] Event type
         * @param {Function} [fn] Handler
         * @param {Object} [ctx] Handler context
         * @returns {Emitter} this
         */
        un : function(e, fn, ctx) {
            if(typeof e === 'string' || typeof e === 'undefined') {
                var storage = this[storageExpando];
                if(storage) {
                    if(e) { // if event type was passed
                        var eventTypes = e.split(' '),
                            i = 0, eventStorage;
                        while(e = eventTypes[i++]) {
                            if(eventStorage = storage[e]) {
                                if(fn) {  // if specific handler was passed
                                    var id = getFnId(fn, ctx),
                                        ids = eventStorage.ids;
                                    if(id in ids) {
                                        var list = eventStorage.list,
                                            item = ids[id],
                                            prev = item.prev,
                                            next = item.next;

                                        if(prev) {
                                            prev.next = next;
                                        } else if(item === list.first) {
                                            list.first = next;
                                        }

                                        if(next) {
                                            next.prev = prev;
                                        } else if(item === list.last) {
                                            list.last = prev;
                                        }

                                        delete ids[id];
                                    }
                                } else {
                                    delete this[storageExpando][e];
                                }
                            }
                        }
                    } else {
                        delete this[storageExpando];
                    }
                }
            } else {
                for(var key in e) {
                    e.hasOwnProperty(key) && this.un(key, e[key], fn);
                }
            }

            return this;
        },

        /**
         * Fires event handlers
         * @param {String|events:Event} e Event
         * @param {Object} [data] Additional data
         * @returns {Emitter} this
         */
        emit : function(e, data) {
            var storage = this[storageExpando],
                eventInstantiated = false;

            if(storage) {
                var eventTypes = [typeof e === 'string'? e : e.type, '*'],
                    i = 0, eventType, eventStorage;
                while(eventType = eventTypes[i++]) {
                    if(eventStorage = storage[eventType]) {
                        var item = eventStorage.list.first,
                            lastItem = eventStorage.list.last,
                            res;
                        while(item) {
                            if(!eventInstantiated) { // instantiate Event only on demand
                                eventInstantiated = true;
                                typeof e === 'string' && (e = new Event(e));
                                e.target || (e.target = this);
                            }

                            e.data = item.data;
                            res = item.fn.apply(item.ctx || this, arguments);
                            if(typeof res !== 'undefined') {
                                e.result = res;
                                if(res === false) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }
                            }

                            item.special && item.special.once &&
                                this.un(e.type, item.fn, item.ctx);

                            if(item === lastItem) {
                                break;
                            }

                            item = item.next;
                        }
                    }
                }
            }

            return this;
        }
    },
    /**
     * @class Emitter
     * @exports events:Emitter
     */
    Emitter = inherit(
        EmitterProps,
        EmitterProps);

provide({
    Emitter : Emitter,
    Event : Event
});

});

/* end: ../../libs/bem-core/common.blocks/events/events.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/vow/vow.vanilla.js */
/**
 * @module vow
 * @author Filatov Dmitry <dfilatov@yandex-team.ru>
 * @version 0.4.8
 * @license
 * Dual licensed under the MIT and GPL licenses:
 *   * http://www.opensource.org/licenses/mit-license.php
 *   * http://www.gnu.org/licenses/gpl.html
 */

(function(global) {

var undef,
    nextTick = (function() {
        var fns = [],
            enqueueFn = function(fn) {
                return fns.push(fn) === 1;
            },
            callFns = function() {
                var fnsToCall = fns, i = 0, len = fns.length;
                fns = [];
                while(i < len) {
                    fnsToCall[i++]();
                }
            };

        if(typeof setImmediate === 'function') { // ie10, nodejs >= 0.10
            return function(fn) {
                enqueueFn(fn) && setImmediate(callFns);
            };
        }

        if(typeof process === 'object' && process.nextTick) { // nodejs < 0.10
            return function(fn) {
                enqueueFn(fn) && process.nextTick(callFns);
            };
        }

        if(global.postMessage) { // modern browsers
            var isPostMessageAsync = true;
            if(global.attachEvent) {
                var checkAsync = function() {
                        isPostMessageAsync = false;
                    };
                global.attachEvent('onmessage', checkAsync);
                global.postMessage('__checkAsync', '*');
                global.detachEvent('onmessage', checkAsync);
            }

            if(isPostMessageAsync) {
                var msg = '__promise' + +new Date,
                    onMessage = function(e) {
                        if(e.data === msg) {
                            e.stopPropagation && e.stopPropagation();
                            callFns();
                        }
                    };

                global.addEventListener?
                    global.addEventListener('message', onMessage, true) :
                    global.attachEvent('onmessage', onMessage);

                return function(fn) {
                    enqueueFn(fn) && global.postMessage(msg, '*');
                };
            }
        }

        var doc = global.document;
        if('onreadystatechange' in doc.createElement('script')) { // ie6-ie8
            var createScript = function() {
                    var script = doc.createElement('script');
                    script.onreadystatechange = function() {
                        script.parentNode.removeChild(script);
                        script = script.onreadystatechange = null;
                        callFns();
                };
                (doc.documentElement || doc.body).appendChild(script);
            };

            return function(fn) {
                enqueueFn(fn) && createScript();
            };
        }

        return function(fn) { // old browsers
            enqueueFn(fn) && setTimeout(callFns, 0);
        };
    })(),
    throwException = function(e) {
        nextTick(function() {
            throw e;
        });
    },
    isFunction = function(obj) {
        return typeof obj === 'function';
    },
    isObject = function(obj) {
        return obj !== null && typeof obj === 'object';
    },
    toStr = Object.prototype.toString,
    isArray = Array.isArray || function(obj) {
        return toStr.call(obj) === '[object Array]';
    },
    getArrayKeys = function(arr) {
        var res = [],
            i = 0, len = arr.length;
        while(i < len) {
            res.push(i++);
        }
        return res;
    },
    getObjectKeys = Object.keys || function(obj) {
        var res = [];
        for(var i in obj) {
            obj.hasOwnProperty(i) && res.push(i);
        }
        return res;
    },
    defineCustomErrorType = function(name) {
        var res = function(message) {
            this.name = name;
            this.message = message;
        };

        res.prototype = new Error();

        return res;
    },
    wrapOnFulfilled = function(onFulfilled, idx) {
        return function(val) {
            onFulfilled.call(this, val, idx);
        };
    };

/**
 * @class Deferred
 * @exports vow:Deferred
 * @description
 * The `Deferred` class is used to encapsulate newly-created promise object along with functions that resolve, reject or notify it.
 */

/**
 * @constructor
 * @description
 * You can use `vow.defer()` instead of using this constructor.
 *
 * `new vow.Deferred()` gives the same result as `vow.defer()`.
 */
var Deferred = function() {
    this._promise = new Promise();
};

Deferred.prototype = /** @lends Deferred.prototype */{
    /**
     * Returns corresponding promise.
     *
     * @returns {vow:Promise}
     */
    promise : function() {
        return this._promise;
    },

    /**
     * Resolves corresponding promise with given `value`.
     *
     * @param {*} value
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promise = defer.promise();
     *
     * promise.then(function(value) {
     *     // value is "'success'" here
     * });
     *
     * defer.resolve('success');
     * ```
     */
    resolve : function(value) {
        this._promise.isResolved() || this._promise._resolve(value);
    },

    /**
     * Rejects corresponding promise with given `reason`.
     *
     * @param {*} reason
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promise = defer.promise();
     *
     * promise.fail(function(reason) {
     *     // reason is "'something is wrong'" here
     * });
     *
     * defer.reject('something is wrong');
     * ```
     */
    reject : function(reason) {
        if(this._promise.isResolved()) {
            return;
        }

        if(vow.isPromise(reason)) {
            reason = reason.then(function(val) {
                var defer = vow.defer();
                defer.reject(val);
                return defer.promise();
            });
            this._promise._resolve(reason);
        }
        else {
            this._promise._reject(reason);
        }
    },

    /**
     * Notifies corresponding promise with given `value`.
     *
     * @param {*} value
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promise = defer.promise();
     *
     * promise.progress(function(value) {
     *     // value is "'20%'", "'40%'" here
     * });
     *
     * defer.notify('20%');
     * defer.notify('40%');
     * ```
     */
    notify : function(value) {
        this._promise.isResolved() || this._promise._notify(value);
    }
};

var PROMISE_STATUS = {
    PENDING   : 0,
    RESOLVED  : 1,
    FULFILLED : 2,
    REJECTED  : 3
};

/**
 * @class Promise
 * @exports vow:Promise
 * @description
 * The `Promise` class is used when you want to give to the caller something to subscribe to,
 * but not the ability to resolve or reject the deferred.
 */

/**
 * @constructor
 * @param {Function} resolver See https://github.com/domenic/promises-unwrapping/blob/master/README.md#the-promise-constructor for details.
 * @description
 * You should use this constructor directly only if you are going to use `vow` as DOM Promises implementation.
 * In other case you should use `vow.defer()` and `defer.promise()` methods.
 * @example
 * ```js
 * function fetchJSON(url) {
 *     return new vow.Promise(function(resolve, reject, notify) {
 *         var xhr = new XMLHttpRequest();
 *         xhr.open('GET', url);
 *         xhr.responseType = 'json';
 *         xhr.send();
 *         xhr.onload = function() {
 *             if(xhr.response) {
 *                 resolve(xhr.response);
 *             }
 *             else {
 *                 reject(new TypeError());
 *             }
 *         };
 *     });
 * }
 * ```
 */
var Promise = function(resolver) {
    this._value = undef;
    this._status = PROMISE_STATUS.PENDING;

    this._fulfilledCallbacks = [];
    this._rejectedCallbacks = [];
    this._progressCallbacks = [];

    if(resolver) { // NOTE: see https://github.com/domenic/promises-unwrapping/blob/master/README.md
        var _this = this,
            resolverFnLen = resolver.length;

        resolver(
            function(val) {
                _this.isResolved() || _this._resolve(val);
            },
            resolverFnLen > 1?
                function(reason) {
                    _this.isResolved() || _this._reject(reason);
                } :
                undef,
            resolverFnLen > 2?
                function(val) {
                    _this.isResolved() || _this._notify(val);
                } :
                undef);
    }
};

Promise.prototype = /** @lends Promise.prototype */ {
    /**
     * Returns value of fulfilled promise or reason in case of rejection.
     *
     * @returns {*}
     */
    valueOf : function() {
        return this._value;
    },

    /**
     * Returns `true` if promise is resolved.
     *
     * @returns {Boolean}
     */
    isResolved : function() {
        return this._status !== PROMISE_STATUS.PENDING;
    },

    /**
     * Returns `true` if promise is fulfilled.
     *
     * @returns {Boolean}
     */
    isFulfilled : function() {
        return this._status === PROMISE_STATUS.FULFILLED;
    },

    /**
     * Returns `true` if promise is rejected.
     *
     * @returns {Boolean}
     */
    isRejected : function() {
        return this._status === PROMISE_STATUS.REJECTED;
    },

    /**
     * Adds reactions to promise.
     *
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise} A new promise, see https://github.com/promises-aplus/promises-spec for details
     */
    then : function(onFulfilled, onRejected, onProgress, ctx) {
        var defer = new Deferred();
        this._addCallbacks(defer, onFulfilled, onRejected, onProgress, ctx);
        return defer.promise();
    },

    /**
     * Adds rejection reaction only. It is shortcut for `promise.then(undefined, onRejected)`.
     *
     * @param {Function} onRejected Callback to be called with the value after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    'catch' : function(onRejected, ctx) {
        return this.then(undef, onRejected, ctx);
    },

    /**
     * Adds rejection reaction only. It is shortcut for `promise.then(null, onRejected)`. It's alias for `catch`.
     *
     * @param {Function} onRejected Callback to be called with the value after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    fail : function(onRejected, ctx) {
        return this.then(undef, onRejected, ctx);
    },

    /**
     * Adds resolving reaction (to fulfillment and rejection both).
     *
     * @param {Function} onResolved Callback that to be called with the value after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    always : function(onResolved, ctx) {
        var _this = this,
            cb = function() {
                return onResolved.call(this, _this);
            };

        return this.then(cb, cb, ctx);
    },

    /**
     * Adds progress reaction.
     *
     * @param {Function} onProgress Callback to be called with the value when promise has been notified
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    progress : function(onProgress, ctx) {
        return this.then(undef, undef, onProgress, ctx);
    },

    /**
     * Like `promise.then`, but "spreads" the array into a variadic value handler.
     * It is useful with `vow.all` and `vow.allResolved` methods.
     *
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.all([defer1.promise(), defer2.promise()]).spread(function(arg1, arg2) {
     *     // arg1 is "1", arg2 is "'two'" here
     * });
     *
     * defer1.resolve(1);
     * defer2.resolve('two');
     * ```
     */
    spread : function(onFulfilled, onRejected, ctx) {
        return this.then(
            function(val) {
                return onFulfilled.apply(this, val);
            },
            onRejected,
            ctx);
    },

    /**
     * Like `then`, but terminates a chain of promises.
     * If the promise has been rejected, throws it as an exception in a future turn of the event loop.
     *
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     *
     * @example
     * ```js
     * var defer = vow.defer();
     * defer.reject(Error('Internal error'));
     * defer.promise().done(); // exception to be thrown
     * ```
     */
    done : function(onFulfilled, onRejected, onProgress, ctx) {
        this
            .then(onFulfilled, onRejected, onProgress, ctx)
            .fail(throwException);
    },

    /**
     * Returns a new promise that will be fulfilled in `delay` milliseconds if the promise is fulfilled,
     * or immediately rejected if promise is rejected.
     *
     * @param {Number} delay
     * @returns {vow:Promise}
     */
    delay : function(delay) {
        var timer,
            promise = this.then(function(val) {
                var defer = new Deferred();
                timer = setTimeout(
                    function() {
                        defer.resolve(val);
                    },
                    delay);

                return defer.promise();
            });

        promise.always(function() {
            clearTimeout(timer);
        });

        return promise;
    },

    /**
     * Returns a new promise that will be rejected in `timeout` milliseconds
     * if the promise is not resolved beforehand.
     *
     * @param {Number} timeout
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var defer = vow.defer(),
     *     promiseWithTimeout1 = defer.promise().timeout(50),
     *     promiseWithTimeout2 = defer.promise().timeout(200);
     *
     * setTimeout(
     *     function() {
     *         defer.resolve('ok');
     *     },
     *     100);
     *
     * promiseWithTimeout1.fail(function(reason) {
     *     // promiseWithTimeout to be rejected in 50ms
     * });
     *
     * promiseWithTimeout2.then(function(value) {
     *     // promiseWithTimeout to be fulfilled with "'ok'" value
     * });
     * ```
     */
    timeout : function(timeout) {
        var defer = new Deferred(),
            timer = setTimeout(
                function() {
                    defer.reject(new vow.TimedOutError('timed out'));
                },
                timeout);

        this.then(
            function(val) {
                defer.resolve(val);
            },
            function(reason) {
                defer.reject(reason);
            });

        defer.promise().always(function() {
            clearTimeout(timer);
        });

        return defer.promise();
    },

    _vow : true,

    _resolve : function(val) {
        if(this._status > PROMISE_STATUS.RESOLVED) {
            return;
        }

        if(val === this) {
            this._reject(TypeError('Can\'t resolve promise with itself'));
            return;
        }

        this._status = PROMISE_STATUS.RESOLVED;

        if(val && !!val._vow) { // shortpath for vow.Promise
            val.isFulfilled()?
                this._fulfill(val.valueOf()) :
                val.isRejected()?
                    this._reject(val.valueOf()) :
                    val.then(
                        this._fulfill,
                        this._reject,
                        this._notify,
                        this);
            return;
        }

        if(isObject(val) || isFunction(val)) {
            var then;
            try {
                then = val.then;
            }
            catch(e) {
                this._reject(e);
                return;
            }

            if(isFunction(then)) {
                var _this = this,
                    isResolved = false;

                try {
                    then.call(
                        val,
                        function(val) {
                            if(isResolved) {
                                return;
                            }

                            isResolved = true;
                            _this._resolve(val);
                        },
                        function(err) {
                            if(isResolved) {
                                return;
                            }

                            isResolved = true;
                            _this._reject(err);
                        },
                        function(val) {
                            _this._notify(val);
                        });
                }
                catch(e) {
                    isResolved || this._reject(e);
                }

                return;
            }
        }

        this._fulfill(val);
    },

    _fulfill : function(val) {
        if(this._status > PROMISE_STATUS.RESOLVED) {
            return;
        }

        this._status = PROMISE_STATUS.FULFILLED;
        this._value = val;

        this._callCallbacks(this._fulfilledCallbacks, val);
        this._fulfilledCallbacks = this._rejectedCallbacks = this._progressCallbacks = undef;
    },

    _reject : function(reason) {
        if(this._status > PROMISE_STATUS.RESOLVED) {
            return;
        }

        this._status = PROMISE_STATUS.REJECTED;
        this._value = reason;

        this._callCallbacks(this._rejectedCallbacks, reason);
        this._fulfilledCallbacks = this._rejectedCallbacks = this._progressCallbacks = undef;
    },

    _notify : function(val) {
        this._callCallbacks(this._progressCallbacks, val);
    },

    _addCallbacks : function(defer, onFulfilled, onRejected, onProgress, ctx) {
        if(onRejected && !isFunction(onRejected)) {
            ctx = onRejected;
            onRejected = undef;
        }
        else if(onProgress && !isFunction(onProgress)) {
            ctx = onProgress;
            onProgress = undef;
        }

        var cb;

        if(!this.isRejected()) {
            cb = { defer : defer, fn : isFunction(onFulfilled)? onFulfilled : undef, ctx : ctx };
            this.isFulfilled()?
                this._callCallbacks([cb], this._value) :
                this._fulfilledCallbacks.push(cb);
        }

        if(!this.isFulfilled()) {
            cb = { defer : defer, fn : onRejected, ctx : ctx };
            this.isRejected()?
                this._callCallbacks([cb], this._value) :
                this._rejectedCallbacks.push(cb);
        }

        if(this._status <= PROMISE_STATUS.RESOLVED) {
            this._progressCallbacks.push({ defer : defer, fn : onProgress, ctx : ctx });
        }
    },

    _callCallbacks : function(callbacks, arg) {
        var len = callbacks.length;
        if(!len) {
            return;
        }

        var isResolved = this.isResolved(),
            isFulfilled = this.isFulfilled();

        nextTick(function() {
            var i = 0, cb, defer, fn;
            while(i < len) {
                cb = callbacks[i++];
                defer = cb.defer;
                fn = cb.fn;

                if(fn) {
                    var ctx = cb.ctx,
                        res;
                    try {
                        res = ctx? fn.call(ctx, arg) : fn(arg);
                    }
                    catch(e) {
                        defer.reject(e);
                        continue;
                    }

                    isResolved?
                        defer.resolve(res) :
                        defer.notify(res);
                }
                else {
                    isResolved?
                        isFulfilled?
                            defer.resolve(arg) :
                            defer.reject(arg) :
                        defer.notify(arg);
                }
            }
        });
    }
};

/** @lends Promise */
var staticMethods = {
    /**
     * Coerces given `value` to a promise, or returns the `value` if it's already a promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    cast : function(value) {
        return vow.cast(value);
    },

    /**
     * Returns a promise to be fulfilled only after all the items in `iterable` are fulfilled,
     * or to be rejected when any of the `iterable` is rejected.
     *
     * @param {Array|Object} iterable
     * @returns {vow:Promise}
     */
    all : function(iterable) {
        return vow.all(iterable);
    },

    /**
     * Returns a promise to be fulfilled only when any of the items in `iterable` are fulfilled,
     * or to be rejected when the first item is rejected.
     *
     * @param {Array} iterable
     * @returns {vow:Promise}
     */
    race : function(iterable) {
        return vow.anyResolved(iterable);
    },

    /**
     * Returns a promise that has already been resolved with the given `value`.
     * If `value` is a promise, returned promise will be adopted with the state of given promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    resolve : function(value) {
        return vow.resolve(value);
    },

    /**
     * Returns a promise that has already been rejected with the given `reason`.
     *
     * @param {*} reason
     * @returns {vow:Promise}
     */
    reject : function(reason) {
        return vow.reject(reason);
    }
};

for(var prop in staticMethods) {
    staticMethods.hasOwnProperty(prop) &&
        (Promise[prop] = staticMethods[prop]);
}

var vow = /** @exports vow */ {
    Deferred : Deferred,

    Promise : Promise,

    /**
     * Creates a new deferred. This method is a factory method for `vow:Deferred` class.
     * It's equivalent to `new vow.Deferred()`.
     *
     * @returns {vow:Deferred}
     */
    defer : function() {
        return new Deferred();
    },

    /**
     * Static equivalent to `promise.then`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise}
     */
    when : function(value, onFulfilled, onRejected, onProgress, ctx) {
        return vow.cast(value).then(onFulfilled, onRejected, onProgress, ctx);
    },

    /**
     * Static equivalent to `promise.fail`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} onRejected Callback that will to be invoked with the reason after promise has been rejected
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    fail : function(value, onRejected, ctx) {
        return vow.when(value, undef, onRejected, ctx);
    },

    /**
     * Static equivalent to `promise.always`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} onResolved Callback that will to be invoked with the reason after promise has been resolved
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    always : function(value, onResolved, ctx) {
        return vow.when(value).always(onResolved, ctx);
    },

    /**
     * Static equivalent to `promise.progress`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} onProgress Callback that will to be invoked with the reason after promise has been notified
     * @param {Object} [ctx] Context of callback execution
     * @returns {vow:Promise}
     */
    progress : function(value, onProgress, ctx) {
        return vow.when(value).progress(onProgress, ctx);
    },

    /**
     * Static equivalent to `promise.spread`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Object} [ctx] Context of callbacks execution
     * @returns {vow:Promise}
     */
    spread : function(value, onFulfilled, onRejected, ctx) {
        return vow.when(value).spread(onFulfilled, onRejected, ctx);
    },

    /**
     * Static equivalent to `promise.done`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Function} [onFulfilled] Callback that will to be invoked with the value after promise has been fulfilled
     * @param {Function} [onRejected] Callback that will to be invoked with the reason after promise has been rejected
     * @param {Function} [onProgress] Callback that will to be invoked with the value after promise has been notified
     * @param {Object} [ctx] Context of callbacks execution
     */
    done : function(value, onFulfilled, onRejected, onProgress, ctx) {
        vow.when(value).done(onFulfilled, onRejected, onProgress, ctx);
    },

    /**
     * Checks whether the given `value` is a promise-like object
     *
     * @param {*} value
     * @returns {Boolean}
     *
     * @example
     * ```js
     * vow.isPromise('something'); // returns false
     * vow.isPromise(vow.defer().promise()); // returns true
     * vow.isPromise({ then : function() { }); // returns true
     * ```
     */
    isPromise : function(value) {
        return isObject(value) && isFunction(value.then);
    },

    /**
     * Coerces given `value` to a promise, or returns the `value` if it's already a promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    cast : function(value) {
        return vow.isPromise(value)?
            value :
            vow.resolve(value);
    },

    /**
     * Static equivalent to `promise.valueOf`.
     * If given `value` is not an instance of `vow.Promise`, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {*}
     */
    valueOf : function(value) {
        return value && isFunction(value.valueOf)? value.valueOf() : value;
    },

    /**
     * Static equivalent to `promise.isFulfilled`.
     * If given `value` is not an instance of `vow.Promise`, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {Boolean}
     */
    isFulfilled : function(value) {
        return value && isFunction(value.isFulfilled)? value.isFulfilled() : true;
    },

    /**
     * Static equivalent to `promise.isRejected`.
     * If given `value` is not an instance of `vow.Promise`, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {Boolean}
     */
    isRejected : function(value) {
        return value && isFunction(value.isRejected)? value.isRejected() : false;
    },

    /**
     * Static equivalent to `promise.isResolved`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @returns {Boolean}
     */
    isResolved : function(value) {
        return value && isFunction(value.isResolved)? value.isResolved() : true;
    },

    /**
     * Returns a promise that has already been resolved with the given `value`.
     * If `value` is a promise, returned promise will be adopted with the state of given promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    resolve : function(value) {
        var res = vow.defer();
        res.resolve(value);
        return res.promise();
    },

    /**
     * Returns a promise that has already been fulfilled with the given `value`.
     * If `value` is a promise, returned promise will be fulfilled with fulfill/rejection value of given promise.
     *
     * @param {*} value
     * @returns {vow:Promise}
     */
    fulfill : function(value) {
        var defer = vow.defer(),
            promise = defer.promise();

        defer.resolve(value);

        return promise.isFulfilled()?
            promise :
            promise.then(null, function(reason) {
                return reason;
            });
    },

    /**
     * Returns a promise that has already been rejected with the given `reason`.
     * If `reason` is a promise, returned promise will be rejected with fulfill/rejection value of given promise.
     *
     * @param {*} reason
     * @returns {vow:Promise}
     */
    reject : function(reason) {
        var defer = vow.defer();
        defer.reject(reason);
        return defer.promise();
    },

    /**
     * Invokes a given function `fn` with arguments `args`
     *
     * @param {Function} fn
     * @param {...*} [args]
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var promise1 = vow.invoke(function(value) {
     *         return value;
     *     }, 'ok'),
     *     promise2 = vow.invoke(function() {
     *         throw Error();
     *     });
     *
     * promise1.isFulfilled(); // true
     * promise1.valueOf(); // 'ok'
     * promise2.isRejected(); // true
     * promise2.valueOf(); // instance of Error
     * ```
     */
    invoke : function(fn, args) {
        var len = Math.max(arguments.length - 1, 0),
            callArgs;
        if(len) { // optimization for V8
            callArgs = Array(len);
            var i = 0;
            while(i < len) {
                callArgs[i++] = arguments[i];
            }
        }

        try {
            return vow.resolve(callArgs?
                fn.apply(global, callArgs) :
                fn.call(global));
        }
        catch(e) {
            return vow.reject(e);
        }
    },

    /**
     * Returns a promise to be fulfilled only after all the items in `iterable` are fulfilled,
     * or to be rejected when any of the `iterable` is rejected.
     *
     * @param {Array|Object} iterable
     * @returns {vow:Promise}
     *
     * @example
     * with array:
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.all([defer1.promise(), defer2.promise(), 3])
     *     .then(function(value) {
     *          // value is "[1, 2, 3]" here
     *     });
     *
     * defer1.resolve(1);
     * defer2.resolve(2);
     * ```
     *
     * @example
     * with object:
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.all({ p1 : defer1.promise(), p2 : defer2.promise(), p3 : 3 })
     *     .then(function(value) {
     *          // value is "{ p1 : 1, p2 : 2, p3 : 3 }" here
     *     });
     *
     * defer1.resolve(1);
     * defer2.resolve(2);
     * ```
     */
    all : function(iterable) {
        var defer = new Deferred(),
            isPromisesArray = isArray(iterable),
            keys = isPromisesArray?
                getArrayKeys(iterable) :
                getObjectKeys(iterable),
            len = keys.length,
            res = isPromisesArray? [] : {};

        if(!len) {
            defer.resolve(res);
            return defer.promise();
        }

        var i = len;
        vow._forEach(
            iterable,
            function(value, idx) {
                res[keys[idx]] = value;
                if(!--i) {
                    defer.resolve(res);
                }
            },
            defer.reject,
            defer.notify,
            defer,
            keys);

        return defer.promise();
    },

    /**
     * Returns a promise to be fulfilled only after all the items in `iterable` are resolved.
     *
     * @param {Array|Object} iterable
     * @returns {vow:Promise}
     *
     * @example
     * ```js
     * var defer1 = vow.defer(),
     *     defer2 = vow.defer();
     *
     * vow.allResolved([defer1.promise(), defer2.promise()]).spread(function(promise1, promise2) {
     *     promise1.isRejected(); // returns true
     *     promise1.valueOf(); // returns "'error'"
     *     promise2.isFulfilled(); // returns true
     *     promise2.valueOf(); // returns "'ok'"
     * });
     *
     * defer1.reject('error');
     * defer2.resolve('ok');
     * ```
     */
    allResolved : function(iterable) {
        var defer = new Deferred(),
            isPromisesArray = isArray(iterable),
            keys = isPromisesArray?
                getArrayKeys(iterable) :
                getObjectKeys(iterable),
            i = keys.length,
            res = isPromisesArray? [] : {};

        if(!i) {
            defer.resolve(res);
            return defer.promise();
        }

        var onResolved = function() {
                --i || defer.resolve(iterable);
            };

        vow._forEach(
            iterable,
            onResolved,
            onResolved,
            defer.notify,
            defer,
            keys);

        return defer.promise();
    },

    allPatiently : function(iterable) {
        return vow.allResolved(iterable).then(function() {
            var isPromisesArray = isArray(iterable),
                keys = isPromisesArray?
                    getArrayKeys(iterable) :
                    getObjectKeys(iterable),
                rejectedPromises, fulfilledPromises,
                len = keys.length, i = 0, key, promise;

            if(!len) {
                return isPromisesArray? [] : {};
            }

            while(i < len) {
                key = keys[i++];
                promise = iterable[key];
                if(vow.isRejected(promise)) {
                    rejectedPromises || (rejectedPromises = isPromisesArray? [] : {});
                    isPromisesArray?
                        rejectedPromises.push(promise.valueOf()) :
                        rejectedPromises[key] = promise.valueOf();
                }
                else if(!rejectedPromises) {
                    (fulfilledPromises || (fulfilledPromises = isPromisesArray? [] : {}))[key] = vow.valueOf(promise);
                }
            }

            if(rejectedPromises) {
                throw rejectedPromises;
            }

            return fulfilledPromises;
        });
    },

    /**
     * Returns a promise to be fulfilled only when any of the items in `iterable` is fulfilled,
     * or to be rejected when all the items are rejected (with the reason of the first rejected item).
     *
     * @param {Array} iterable
     * @returns {vow:Promise}
     */
    any : function(iterable) {
        var defer = new Deferred(),
            len = iterable.length;

        if(!len) {
            defer.reject(Error());
            return defer.promise();
        }

        var i = 0, reason;
        vow._forEach(
            iterable,
            defer.resolve,
            function(e) {
                i || (reason = e);
                ++i === len && defer.reject(reason);
            },
            defer.notify,
            defer);

        return defer.promise();
    },

    /**
     * Returns a promise to be fulfilled only when any of the items in `iterable` is fulfilled,
     * or to be rejected when the first item is rejected.
     *
     * @param {Array} iterable
     * @returns {vow:Promise}
     */
    anyResolved : function(iterable) {
        var defer = new Deferred(),
            len = iterable.length;

        if(!len) {
            defer.reject(Error());
            return defer.promise();
        }

        vow._forEach(
            iterable,
            defer.resolve,
            defer.reject,
            defer.notify,
            defer);

        return defer.promise();
    },

    /**
     * Static equivalent to `promise.delay`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Number} delay
     * @returns {vow:Promise}
     */
    delay : function(value, delay) {
        return vow.resolve(value).delay(delay);
    },

    /**
     * Static equivalent to `promise.timeout`.
     * If given `value` is not a promise, then `value` is equivalent to fulfilled promise.
     *
     * @param {*} value
     * @param {Number} timeout
     * @returns {vow:Promise}
     */
    timeout : function(value, timeout) {
        return vow.resolve(value).timeout(timeout);
    },

    _forEach : function(promises, onFulfilled, onRejected, onProgress, ctx, keys) {
        var len = keys? keys.length : promises.length,
            i = 0;

        while(i < len) {
            vow.when(
                promises[keys? keys[i] : i],
                wrapOnFulfilled(onFulfilled, i),
                onRejected,
                onProgress,
                ctx);
            ++i;
        }
    },

    TimedOutError : defineCustomErrorType('TimedOut')
};

var defineAsGlobal = true;
if(typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = vow;
    defineAsGlobal = false;
}

if(typeof modules === 'object' && isFunction(modules.define)) {
    modules.define('vow', function(provide) {
        provide(vow);
    });
    defineAsGlobal = false;
}

if(typeof define === 'function') {
    define(function(require, exports, module) {
        module.exports = vow;
    });
    defineAsGlobal = false;
}

defineAsGlobal && (global.vow = vow);

})(this);

/* end: ../../libs/bem-core/common.blocks/vow/vow.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/querystring/querystring.vanilla.js */
/**
 * @module querystring
 * @description A set of helpers to work with query strings
 */

modules.define('querystring', ['querystring__uri'], function(provide, uri) {

var hasOwnProperty = Object.prototype.hasOwnProperty;

function addParam(res, name, val) {
    /* jshint eqnull: true */
    res.push(encodeURIComponent(name) + '=' + (val == null? '' : encodeURIComponent(val)));
}

provide(/** @exports */{
    /**
     * Parse a query string to an object
     * @param {String} str
     * @returns {Object}
     */
    parse : function(str) {
        if(!str) {
            return {};
        }

        return str.split('&').reduce(
            function(res, pair) {
                if(!pair) {
                    return res;
                }

                var eq = pair.indexOf('='),
                    name, val;

                if(eq >= 0) {
                    name = pair.substr(0, eq);
                    val = pair.substr(eq + 1);
                } else {
                    name = pair;
                    val = '';
                }

                name = uri.decodeURIComponent(name);
                val = uri.decodeURIComponent(val);

                hasOwnProperty.call(res, name)?
                    Array.isArray(res[name])?
                        res[name].push(val) :
                        res[name] = [res[name], val] :
                    res[name] = val;

                return res;
            },
            {});
    },

    /**
     * Serialize an object to a query string
     * @param {Object} obj
     * @returns {String}
     */
    stringify : function(obj) {
        return Object.keys(obj)
            .reduce(
                function(res, name) {
                    var val = obj[name];
                    Array.isArray(val)?
                        val.forEach(function(val) {
                            addParam(res, name, val);
                        }) :
                        addParam(res, name, val);
                    return res;
                },
                [])
            .join('&');
    }
});

});

/* end: ../../libs/bem-core/common.blocks/querystring/querystring.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/querystring/__uri/querystring__uri.vanilla.js */
/**
 * @module querystring__uri
 * @description A set of helpers to work with URI
 */

modules.define('querystring__uri',  function(provide) {

// Equivalency table for cp1251 and utf8.
var map = { '%D0' : '%D0%A0', '%C0' : '%D0%90', '%C1' : '%D0%91', '%C2' : '%D0%92', '%C3' : '%D0%93', '%C4' : '%D0%94', '%C5' : '%D0%95', '%A8' : '%D0%81', '%C6' : '%D0%96', '%C7' : '%D0%97', '%C8' : '%D0%98', '%C9' : '%D0%99', '%CA' : '%D0%9A', '%CB' : '%D0%9B', '%CC' : '%D0%9C', '%CD' : '%D0%9D', '%CE' : '%D0%9E', '%CF' : '%D0%9F', '%D1' : '%D0%A1', '%D2' : '%D0%A2', '%D3' : '%D0%A3', '%D4' : '%D0%A4', '%D5' : '%D0%A5', '%D6' : '%D0%A6', '%D7' : '%D0%A7', '%D8' : '%D0%A8', '%D9' : '%D0%A9', '%DA' : '%D0%AA', '%DB' : '%D0%AB', '%DC' : '%D0%AC', '%DD' : '%D0%AD', '%DE' : '%D0%AE', '%DF' : '%D0%AF', '%E0' : '%D0%B0', '%E1' : '%D0%B1', '%E2' : '%D0%B2', '%E3' : '%D0%B3', '%E4' : '%D0%B4', '%E5' : '%D0%B5', '%B8' : '%D1%91', '%E6' : '%D0%B6', '%E7' : '%D0%B7', '%E8' : '%D0%B8', '%E9' : '%D0%B9', '%EA' : '%D0%BA', '%EB' : '%D0%BB', '%EC' : '%D0%BC', '%ED' : '%D0%BD', '%EE' : '%D0%BE', '%EF' : '%D0%BF', '%F0' : '%D1%80', '%F1' : '%D1%81', '%F2' : '%D1%82', '%F3' : '%D1%83', '%F4' : '%D1%84', '%F5' : '%D1%85', '%F6' : '%D1%86', '%F7' : '%D1%87', '%F8' : '%D1%88', '%F9' : '%D1%89', '%FA' : '%D1%8A', '%FB' : '%D1%8B', '%FC' : '%D1%8C', '%FD' : '%D1%8D', '%FE' : '%D1%8E', '%FF' : '%D1%8F' };

function convert(str) {
    // Symbol code in cp1251 (hex) : symbol code in utf8)
    return str.replace(
        /%.{2}/g,
        function($0) {
            return map[$0] || $0;
        });
}

function decode(fn,  str) {
    var decoded = '';

    // Try/catch block for getting the encoding of the source string.
    // Error is thrown if a non-UTF8 string is input.
    // If the string was not decoded, it is returned without changes.
    try {
        decoded = fn(str);
    } catch (e1) {
        try {
            decoded = fn(convert(str));
        } catch (e2) {
            decoded = str;
        }
    }

    return decoded;
}

provide(/** @exports */{
    /**
     * Decodes URI string
     * @param {String} str
     * @returns {String}
     */
    decodeURI : function(str) {
        return decode(decodeURI,  str);
    },

    /**
     * Decodes URI component string
     * @param {String} str
     * @returns {String}
     */
    decodeURIComponent : function(str) {
        return decode(decodeURIComponent,  str);
    }
});

});

/* end: ../../libs/bem-core/common.blocks/querystring/__uri/querystring__uri.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/events/__channels/events__channels.vanilla.js */
/**
 * @module events__channels
 */

modules.define('events__channels', ['events'], function(provide, events) {

var undef,
    channels = {};

provide(
    /**
     * Returns/destroys a named communication channel
     * @exports
     * @param {String} [id='default'] Channel ID
     * @param {Boolean} [drop=false] Destroy the channel
     * @returns {events:Emitter|undefined} Communication channel
     */
    function(id, drop) {
        if(typeof id === 'boolean') {
            drop = id;
            id = undef;
        }

        id || (id = 'default');

        if(drop) {
            if(channels[id]) {
                channels[id].un();
                delete channels[id];
            }
            return;
        }

        return channels[id] || (channels[id] = new events.Emitter());
    });
});

/* end: ../../libs/bem-core/common.blocks/events/__channels/events__channels.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/functions/__throttle/functions__throttle.vanilla.js */
/**
 * @module functions__throttle
 */

modules.define('functions__throttle', function(provide) {

var global = this.global;

provide(
    /**
     * Throttle given function
     * @exports
     * @param {Function} fn function to throttle
     * @param {Number} timeout throttle interval
     * @param {Boolean} [invokeAsap=true] invoke before first interval
     * @param {Object} [ctx] context of function invocation
     * @returns {Function} throttled function
     */
    function(fn, timeout, invokeAsap, ctx) {
        var typeofInvokeAsap = typeof invokeAsap;
        if(typeofInvokeAsap === 'undefined') {
            invokeAsap = true;
        } else if(arguments.length === 3 && typeofInvokeAsap !== 'boolean') {
            ctx = invokeAsap;
            invokeAsap = true;
        }

        var timer, args, needInvoke,
            wrapper = function() {
                if(needInvoke) {
                    fn.apply(ctx, args);
                    needInvoke = false;
                    timer = global.setTimeout(wrapper, timeout);
                } else {
                    timer = null;
                }
            };

        return function() {
            args = arguments;
            ctx || (ctx = this);
            needInvoke = true;

            if(!timer) {
                invokeAsap?
                    wrapper() :
                    timer = global.setTimeout(wrapper, timeout);
            }
        };
    });

});

/* end: ../../libs/bem-core/common.blocks/functions/__throttle/functions__throttle.vanilla.js */
/* begin: ../../libs/bem-core/common.blocks/i-bem/__dom/i-bem__dom.js */
/**
 * @module i-bem__dom
 */

modules.define(
    'i-bem__dom',
    ['i-bem', 'i-bem__internal', 'identify', 'objects', 'functions', 'jquery', 'dom'],
    function(provide, BEM, INTERNAL, identify, objects, functions, $, dom) {

var undef,
    win = $(window),
    doc = $(document),

    /**
     * Storage for DOM elements by unique key
     * @type Object
     */
    uniqIdToDomElems = {},

    /**
     * Storage for blocks by unique key
     * @type Object
     */
    uniqIdToBlock = {},

    /**
     * Storage for DOM element's parent nodes
     * @type Object
     */
    domNodesToParents = {},

    /**
     * Storage for block parameters
     * @type Object
     */
    domElemToParams = {},

    /**
     * Storage for liveCtx event handlers
     * @type Object
     */
    liveEventCtxStorage = {},

    /**
     * Storage for liveClass event handlers
     * @type Object
     */
    liveClassEventStorage = {},

    blocks = BEM.blocks,

    BEM_CLASS = 'i-bem',
    BEM_SELECTOR = '.' + BEM_CLASS,
    BEM_PARAMS_ATTR = 'data-bem',

    NAME_PATTERN = INTERNAL.NAME_PATTERN,

    MOD_DELIM = INTERNAL.MOD_DELIM,
    ELEM_DELIM = INTERNAL.ELEM_DELIM,

    EXTRACT_MODS_RE = RegExp(
        '[^' + MOD_DELIM + ']' + MOD_DELIM + '(' + NAME_PATTERN + ')' +
        '(?:' + MOD_DELIM + '(' + NAME_PATTERN + '))?$'),

    buildModPostfix = INTERNAL.buildModPostfix,
    buildClass = INTERNAL.buildClass,

    reverse = Array.prototype.reverse;

/**
 * Initializes blocks on a DOM element
 * @param {jQuery} domElem DOM element
 * @param {String} uniqInitId ID of the "initialization wave"
 */
function initBlocks(domElem, uniqInitId) {
    var domNode = domElem[0],
        params = getParams(domNode),
        blockName;

    for(blockName in params)
        initBlock(
            blockName,
            domElem,
            processParams(params[blockName], blockName, uniqInitId));
}

/**
 * Initializes a specific block on a DOM element, or returns the existing block if it was already created
 * @param {String} blockName Block name
 * @param {jQuery} domElem DOM element
 * @param {Object} [params] Initialization parameters
 * @param {Boolean} [forceLive=false] Force live initialization
 * @param {Function} [callback] Handler to call after complete initialization
 */
function initBlock(blockName, domElem, params, forceLive, callback) {
    var domNode = domElem[0];

    params || (params = processParams(getBlockParams(domNode, blockName), blockName));

    var uniqId = params.uniqId,
        block = uniqIdToBlock[uniqId];

    if(block) {
        if(block.domElem.index(domNode) < 0) {
            block.domElem = block.domElem.add(domElem);
            objects.extend(block.params, params);
        }

        return block;
    }

    uniqIdToDomElems[uniqId] = uniqIdToDomElems[uniqId]?
        uniqIdToDomElems[uniqId].add(domElem) :
        domElem;

    var parentDomNode = domNode.parentNode;
    if(!parentDomNode || parentDomNode.nodeType === 11) { // jquery doesn't unique disconnected node
        $.unique(uniqIdToDomElems[uniqId]);
    }

    var blockClass = blocks[blockName] || DOM.decl(blockName, {}, { live : true }, true);
    if(!(blockClass._liveInitable = !!blockClass._processLive()) || forceLive || params.live === false) {
        forceLive && domElem.addClass(BEM_CLASS); // add css class for preventing memory leaks in further destructing

        block = new blockClass(uniqIdToDomElems[uniqId], params, !!forceLive);

        delete uniqIdToDomElems[uniqId];
        callback && callback.apply(block, Array.prototype.slice.call(arguments, 4));
        return block;
    }
}

/**
 * Processes and adds necessary block parameters
 * @param {Object} params Initialization parameters
 * @param {String} blockName Block name
 * @param {String} [uniqInitId] ID of the "initialization wave"
 */
function processParams(params, blockName, uniqInitId) {
    params.uniqId ||
        (params.uniqId = (params.id?
            blockName + '-id-' + params.id :
            identify()) + (uniqInitId || identify()));

    return params;
}

/**
 * Helper for searching for a DOM element using a selector inside the context, including the context itself
 * @param {jQuery} ctx Context
 * @param {String} selector CSS selector
 * @param {Boolean} [excludeSelf=false] Exclude context from search
 * @returns {jQuery}
 */
function findDomElem(ctx, selector, excludeSelf) {
    var res = ctx.find(selector);
    return excludeSelf?
       res :
       res.add(ctx.filter(selector));
}

/**
 * Returns parameters of a block's DOM element
 * @param {HTMLElement} domNode DOM node
 * @returns {Object}
 */
function getParams(domNode, blockName) {
    var uniqId = identify(domNode);
    return domElemToParams[uniqId] ||
        (domElemToParams[uniqId] = extractParams(domNode));
}

/**
 * Returns parameters of a block extracted from DOM node
 * @param {HTMLElement} domNode DOM node
 * @param {String} blockName
 * @returns {Object}
 */

function getBlockParams(domNode, blockName) {
    var params = getParams(domNode);
    return params[blockName] || (params[blockName] = {});
}

/**
 * Retrieves block parameters from a DOM element
 * @param {HTMLElement} domNode DOM node
 * @returns {Object}
 */
function extractParams(domNode) {
    var attrVal = domNode.getAttribute(BEM_PARAMS_ATTR);
    return attrVal? JSON.parse(attrVal) : {};
}

/**
 * Uncouple DOM node from the block. If this is the last node, then destroys the block.
 * @param {BEMDOM} block block
 * @param {HTMLElement} domNode DOM node
 */
function removeDomNodeFromBlock(block, domNode) {
    block.domElem.length === 1?
        block._destruct() :
        block.domElem = block.domElem.not(domNode);
}

/**
 * Fills DOM node's parent nodes to the storage
 * @param {jQuery} domElem
 */
function storeDomNodeParents(domElem) {
    domElem.each(function() {
        domNodesToParents[identify(this)] = this.parentNode;
    });
}

/**
 * Returns jQuery collection for provided HTML
 * @param {jQuery|String} html
 * @returns {jQuery}
 */
function getJqueryCollection(html) {
    return $(typeof html === 'string'? $.parseHTML(html, null, true) : html);
}

var DOM;

$(function() {

/**
 * @class BEMDOM
 * @description Base block for creating BEM blocks that have DOM representation
 * @exports
 */

DOM = BEM.decl('i-bem__dom',/** @lends BEMDOM.prototype */{
    /**
     * @constructor
     * @private
     * @param {jQuery} domElem DOM element that the block is created on
     * @param {Object} params Block parameters
     * @param {Boolean} [initImmediately=true]
     */
    __constructor : function(domElem, params, initImmediately) {
        /**
         * DOM elements of block
         * @member {jQuery}
         * @readonly
         */
        this.domElem = domElem;

        /**
         * Cache for names of events on DOM elements
         * @member {Object}
         * @private
         */
        this._eventNameCache = {};

        /**
         * Cache for elements
         * @member {Object}
         * @private
         */
        this._elemCache = {};

        /**
         * @member {String} Unique block ID
         * @private
         */
        this._uniqId = params.uniqId;

        uniqIdToBlock[this._uniqId] = this;

        /**
         * @member {Boolean} Flag for whether it's necessary to unbind from the document and window when destroying the block
         * @private
         */
        this._needSpecialUnbind = false;

        this.__base(null, params, initImmediately);
    },

    /**
     * Finds blocks inside the current block or its elements (including context)
     * @param {String|jQuery} [elem] Block element
     * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
     * @returns {BEMDOM[]}
     */
    findBlocksInside : function(elem, block) {
        return this._findBlocks('find', elem, block);
    },

    /**
     * Finds the first block inside the current block or its elements (including context)
     * @param {String|jQuery} [elem] Block element
     * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
     * @returns {BEMDOM}
     */
    findBlockInside : function(elem, block) {
        return this._findBlocks('find', elem, block, true);
    },

    /**
     * Finds blocks outside the current block or its elements (including context)
     * @param {String|jQuery} [elem] Block element
     * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
     * @returns {BEMDOM[]}
     */
    findBlocksOutside : function(elem, block) {
        return this._findBlocks('parents', elem, block);
    },

    /**
     * Finds the first block outside the current block or its elements (including context)
     * @param {String|jQuery} [elem] Block element
     * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
     * @returns {BEMDOM}
     */
    findBlockOutside : function(elem, block) {
        return this._findBlocks('closest', elem, block)[0] || null;
    },

    /**
     * Finds blocks on DOM elements of the current block or its elements
     * @param {String|jQuery} [elem] Block element
     * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
     * @returns {BEMDOM[]}
     */
    findBlocksOn : function(elem, block) {
        return this._findBlocks('', elem, block);
    },

    /**
     * Finds the first block on DOM elements of the current block or its elements
     * @param {String|jQuery} [elem] Block element
     * @param {String|Object} block Name or description (block,modName,modVal) of the block to find
     * @returns {BEMDOM}
     */
    findBlockOn : function(elem, block) {
        return this._findBlocks('', elem, block, true);
    },

    _findBlocks : function(select, elem, block, onlyFirst) {
        if(!block) {
            block = elem;
            elem = undef;
        }

        var ctxElem = elem?
                (typeof elem === 'string'? this.findElem(elem) : elem) :
                this.domElem,
            isSimpleBlock = typeof block === 'string',
            blockName = isSimpleBlock? block : (block.block || block.blockName),
            selector = '.' +
                (isSimpleBlock?
                    buildClass(blockName) :
                    buildClass(blockName, block.modName, block.modVal)) +
                (onlyFirst? ':first' : ''),
            domElems = ctxElem.filter(selector);

        select && (domElems = domElems.add(ctxElem[select](selector)));

        if(onlyFirst) {
            return domElems[0]? initBlock(blockName, domElems.eq(0), undef, true)._init() : null;
        }

        var res = [],
            uniqIds = {};

        domElems.each(function(i, domElem) {
            var block = initBlock(blockName, $(domElem), undef, true)._init();
            if(!uniqIds[block._uniqId]) {
                uniqIds[block._uniqId] = true;
                res.push(block);
            }
        });

        return res;
    },

    /**
     * Adds an event handler for any DOM element
     * @protected
     * @param {jQuery} domElem DOM element where the event will be listened for
     * @param {String|Object} event Event name or event object
     * @param {Object} [data] Additional event data
     * @param {Function} fn Handler function, which will be executed in the block's context
     * @returns {BEMDOM} this
     */
    bindToDomElem : function(domElem, event, data, fn) {
        if(functions.isFunction(data)) {
            fn = data;
            data = undef;
        }

        fn?
            domElem.bind(
                this._buildEventName(event),
                data,
                $.proxy(fn, this)) :
            objects.each(event, function(fn, event) {
                this.bindToDomElem(domElem, event, data, fn);
            }, this);

        return this;
    },

    /**
     * Adds an event handler to the document
     * @protected
     * @param {String|Object} event Event name or event object
     * @param {Object} [data] Additional event data
     * @param {Function} fn Handler function, which will be executed in the block's context
     * @returns {BEMDOM} this
     */
    bindToDoc : function(event, data, fn) {
        this._needSpecialUnbind = true;
        return this.bindToDomElem(doc, event, data, fn);
    },

    /**
     * Adds an event handler to the window
     * @protected
     * @param {String|Object} event Event name or event object
     * @param {Object} [data] Additional event data
     * @param {Function} fn Handler function, which will be executed in the block's context
     * @returns {BEMDOM} this
     */
    bindToWin : function(event, data, fn) {
        this._needSpecialUnbind = true;
        return this.bindToDomElem(win, event, data, fn);
    },

    /**
     * Adds an event handler to the block's main DOM elements or its nested elements
     * @protected
     * @param {jQuery|String} [elem] Element
     * @param {String|Object} event Event name or event object
     * @param {Object} [data] Additional event data
     * @param {Function} fn Handler function, which will be executed in the block's context
     * @returns {BEMDOM} this
     */
    bindTo : function(elem, event, data, fn) {
        var len = arguments.length;
        if(len === 3) {
            if(functions.isFunction(data)) {
                fn = data;
                if(typeof event === 'object') {
                    data = event;
                    event = elem;
                    elem = this.domElem;
                }
            }
        } else if(len === 2) {
            if(functions.isFunction(event)) {
                fn = event;
                event = elem;
                elem = this.domElem;
            } else if(!(typeof elem === 'string' || elem instanceof $)) {
                data = event;
                event = elem;
                elem = this.domElem;
            }
        } else if(len === 1) {
            event = elem;
            elem = this.domElem;
        }

        typeof elem === 'string' && (elem = this.elem(elem));

        return this.bindToDomElem(elem, event, data, fn);
    },

    /**
     * Removes event handlers from any DOM element
     * @protected
     * @param {jQuery} domElem DOM element where the event was being listened for
     * @param {String|Object} event Event name or event object
     * @param {Function} [fn] Handler function
     * @returns {BEMDOM} this
     */
    unbindFromDomElem : function(domElem, event, fn) {
        if(typeof event === 'string') {
            event = this._buildEventName(event);
            fn?
                domElem.unbind(event, fn) :
                domElem.unbind(event);
        } else {
            objects.each(event, function(fn, event) {
                this.unbindFromDomElem(domElem, event, fn);
            }, this);
        }

        return this;
    },

    /**
     * Removes event handler from document
     * @protected
     * @param {String|Object} event Event name or event object
     * @param {Function} [fn] Handler function
     * @returns {BEMDOM} this
     */
    unbindFromDoc : function(event, fn) {
        return this.unbindFromDomElem(doc, event, fn);
    },

    /**
     * Removes event handler from window
     * @protected
     * @param {String|Object} event Event name or event object
     * @param {Function} [fn] Handler function
     * @returns {BEMDOM} this
     */
    unbindFromWin : function(event, fn) {
        return this.unbindFromDomElem(win, event, fn);
    },

    /**
     * Removes event handlers from the block's main DOM elements or its nested elements
     * @protected
     * @param {jQuery|String} [elem] Nested element
     * @param {String|Object} event Event name or event object
     * @param {Function} [fn] Handler function
     * @returns {BEMDOM} this
     */
    unbindFrom : function(elem, event, fn) {
        var argLen = arguments.length;
        if(argLen === 1) {
            event = elem;
            elem = this.domElem;
        } else if(argLen === 2 && functions.isFunction(event)) {
            fn = event;
            event = elem;
            elem = this.domElem;
        } else if(typeof elem === 'string') {
            elem = this.elem(elem);
        }

        return this.unbindFromDomElem(elem, event, fn);
    },

    /**
     * Builds a full name for an event
     * @private
     * @param {String} event Event name
     * @returns {String}
     */
    _buildEventName : function(event) {
        return event.indexOf(' ') > 1?
            event.split(' ').map(function(e) {
                return this._buildOneEventName(e);
            }, this).join(' ') :
            this._buildOneEventName(event);
    },

    /**
     * Builds a full name for a single event
     * @private
     * @param {String} event Event name
     * @returns {String}
     */
    _buildOneEventName : function(event) {
        var eventNameCache = this._eventNameCache;

        if(event in eventNameCache) return eventNameCache[event];

        var uniq = '.' + this._uniqId;

        if(event.indexOf('.') < 0) return eventNameCache[event] = event + uniq;

        var lego = '.bem_' + this.__self._name;

        return eventNameCache[event] = event.split('.').map(function(e, i) {
            return i === 0? e + lego : lego + '_' + e;
        }).join('') + uniq;
    },

    _ctxEmit : function(e, data) {
        this.__base.apply(this, arguments);

        var _this = this,
            storage = liveEventCtxStorage[_this.__self._buildCtxEventName(e.type)],
            ctxIds = {};

        storage && _this.domElem.each(function(_, ctx) {
            var counter = storage.counter;
            while(ctx && counter) {
                var ctxId = identify(ctx, true);
                if(ctxId) {
                    if(ctxIds[ctxId]) break;
                    var storageCtx = storage.ctxs[ctxId];
                    if(storageCtx) {
                        objects.each(storageCtx, function(handler) {
                            handler.fn.call(
                                handler.ctx || _this,
                                e,
                                data);
                        });
                        counter--;
                    }
                    ctxIds[ctxId] = true;
                }
                ctx = ctx.parentNode || domNodesToParents[ctxId];
            }
        });
    },

    /**
     * Sets a modifier for a block/nested element
     * @param {jQuery} [elem] Nested element
     * @param {String} modName Modifier name
     * @param {String} modVal Modifier value
     * @returns {BEMDOM} this
     */
    setMod : function(elem, modName, modVal) {
        if(elem && typeof modVal !== 'undefined' && elem.length > 1) {
            var _this = this;
            elem.each(function() {
                var item = $(this);
                item.__bemElemName = elem.__bemElemName;
                _this.setMod(item, modName, modVal);
            });
            return _this;
        }
        return this.__base(elem, modName, modVal);
    },

    /**
     * Retrieves modifier value from the DOM node's CSS class
     * @private
     * @param {String} modName Modifier name
     * @param {jQuery} [elem] Nested element
     * @param {String} [elemName] Name of the nested element
     * @returns {String} Modifier value
     */
    _extractModVal : function(modName, elem, elemName) {
        var domNode = (elem || this.domElem)[0],
            matches;

        domNode &&
            (matches = domNode.className
                .match(this.__self._buildModValRE(modName, elemName || elem)));

        return matches? matches[2] || true : '';
    },

    /**
     * Retrieves a name/value list of modifiers
     * @private
     * @param {Array} [modNames] Names of modifiers
     * @param {Object} [elem] Element
     * @returns {Object} Hash of modifier values by names
     */
    _extractMods : function(modNames, elem) {
        var res = {},
            extractAll = !modNames.length,
            countMatched = 0;

        ((elem || this.domElem)[0].className
            .match(this.__self._buildModValRE(
                '(' + (extractAll? NAME_PATTERN : modNames.join('|')) + ')',
                elem,
                'g')) || []).forEach(function(className) {
                    var matches = className.match(EXTRACT_MODS_RE);
                    res[matches[1]] = matches[2] || true;
                    ++countMatched;
                });

        // empty modifier values are not reflected in classes; they must be filled with empty values
        countMatched < modNames.length && modNames.forEach(function(modName) {
            modName in res || (res[modName] = '');
        });

        return res;
    },

    /**
     * Sets a modifier's CSS class for a block's DOM element or nested element
     * @private
     * @param {String} modName Modifier name
     * @param {String} modVal Modifier value
     * @param {String} oldModVal Old modifier value
     * @param {jQuery} [elem] Element
     * @param {String} [elemName] Element name
     */
    _onSetMod : function(modName, modVal, oldModVal, elem, elemName) {
        if(modName !== 'js' || modVal !== '') {
            var _self = this.__self,
                classPrefix = _self._buildModClassPrefix(modName, elemName),
                classRE = _self._buildModValRE(modName, elemName),
                needDel = modVal === '' || modVal === false;

            (elem || this.domElem).each(function() {
                var className = this.className,
                    modClassName = classPrefix;

                modVal !== true && (modClassName += MOD_DELIM + modVal);

                (oldModVal === true?
                    classRE.test(className) :
                    className.indexOf(classPrefix + MOD_DELIM) > -1)?
                        this.className = className.replace(
                            classRE,
                            (needDel? '' : '$1' + modClassName)) :
                        needDel || $(this).addClass(modClassName);
            });

            elemName && this
                .dropElemCache(elemName, modName, oldModVal)
                .dropElemCache(elemName, modName, modVal);
        }

        this.__base.apply(this, arguments);
    },

    /**
     * Finds elements nested in a block
     * @param {jQuery} [ctx=this.domElem] Element where search is being performed
     * @param {String} names Nested element name (or names separated by spaces)
     * @param {String} [modName] Modifier name
     * @param {String} [modVal] Modifier value
     * @param {Boolean} [strictMode=false]
     * @returns {jQuery} DOM elements
     */
    findElem : function(ctx, names, modName, modVal, strictMode) {
        if(typeof ctx === 'string') {
            strictMode = modVal;
            modVal = modName;
            modName = names;
            names = ctx;
            ctx = this.domElem;
        }

        if(typeof modName === 'boolean') {
            strictMode = modName;
            modName = undef;
        }

        var _self = this.__self,
            selector = '.' +
                names.split(' ').map(function(name) {
                    return _self.buildClass(name, modName, modVal);
                }).join(',.'),
            res = findDomElem(ctx, selector);

        return strictMode? this._filterFindElemResults(res) : res;
    },

    /**
     * Filters results of findElem helper execution in strict mode
     * @param {jQuery} res DOM elements
     * @returns {jQuery} DOM elements
     */
    _filterFindElemResults : function(res) {
        var blockSelector = this.buildSelector(),
            domElem = this.domElem;
        return res.filter(function() {
            return domElem.index($(this).closest(blockSelector)) > -1;
        });
    },

    /**
     * Finds elements nested in a block
     * @private
     * @param {String} name Nested element name
     * @param {String} [modName] Modifier name
     * @param {String|Boolean} [modVal] Modifier value
     * @returns {jQuery} DOM elements
     */
    _elem : function(name, modName, modVal) {
        var key = name + buildModPostfix(modName, modVal),
            res;

        if(!(res = this._elemCache[key])) {
            res = this._elemCache[key] = this.findElem(name, modName, modVal);
            res.__bemElemName = name;
        }

        return res;
    },

    /**
     * Lazy search for elements nested in a block (caches results)
     * @param {String} names Nested element name (or names separated by spaces)
     * @param {String} [modName] Modifier name
     * @param {String|Boolean} [modVal=true] Modifier value
     * @returns {jQuery} DOM elements
     */
    elem : function(names, modName, modVal) {
        if(arguments.length === 2) {
            modVal = true;
        }

        if(modName && typeof modName !== 'string') {
            modName.__bemElemName = names;
            return modName;
        }

        if(names.indexOf(' ') < 0) {
            return this._elem(names, modName, modVal);
        }

        var res = $([]);
        names.split(' ').forEach(function(name) {
            res = res.add(this._elem(name, modName, modVal));
        }, this);
        return res;
    },

    /**
     * Finds elements outside the context
     * @param {jQuery} ctx context
     * @param {String} elemName Element name
     * @returns {jQuery} DOM elements
     */
    closestElem : function(ctx, elemName) {
        return ctx.closest(this.buildSelector(elemName));
    },

    /**
     * Clearing the cache for elements
     * @protected
     * @param {String} [names] Nested element name (or names separated by spaces)
     * @param {String} [modName] Modifier name
     * @param {String} [modVal] Modifier value
     * @returns {BEMDOM} this
     */
    dropElemCache : function(names, modName, modVal) {
        if(names) {
            var modPostfix = buildModPostfix(modName, modVal);
            names.indexOf(' ') < 0?
                delete this._elemCache[names + modPostfix] :
                names.split(' ').forEach(function(name) {
                    delete this._elemCache[name + modPostfix];
                }, this);
        } else {
            this._elemCache = {};
        }

        return this;
    },

    /**
     * Retrieves parameters of a block element
     * @param {String|jQuery} elem Element
     * @returns {Object} Parameters
     */
    elemParams : function(elem) {
        var elemName;
        if(typeof elem === 'string') {
            elemName = elem;
            elem = this.elem(elem);
        } else {
            elemName = this.__self._extractElemNameFrom(elem);
        }

        return extractParams(elem[0])[this.__self.buildClass(elemName)] || {};
    },

    /**
     * Elemify given element
     * @param {jQuery} elem Element
     * @param {String} elemName Name
     * @returns {jQuery}
     */
    elemify : function(elem, elemName) {
        (elem = $(elem)).__bemElemName = elemName;
        return elem;
    },

    /**
     * Checks whether a DOM element is in a block
     * @protected
     * @param {jQuery} [ctx=this.domElem] Element where check is being performed
     * @param {jQuery} domElem DOM element
     * @returns {Boolean}
     */
    containsDomElem : function(ctx, domElem) {
        if(arguments.length === 1) {
            domElem = ctx;
            ctx = this.domElem;
        }

        return dom.contains(ctx, domElem);
    },

    /**
     * Builds a CSS selector corresponding to a block/element and modifier
     * @param {String} [elem] Element name
     * @param {String} [modName] Modifier name
     * @param {String} [modVal] Modifier value
     * @returns {String}
     */
    buildSelector : function(elem, modName, modVal) {
        return this.__self.buildSelector(elem, modName, modVal);
    },

    /**
     * Destructs a block
     * @private
     */
    _destruct : function() {
        var _this = this,
            _self = _this.__self;

        _this._needSpecialUnbind && _self.doc.add(_self.win).unbind('.' + _this._uniqId);

        _this.__base();

        delete uniqIdToBlock[_this.un()._uniqId];
    }

}, /** @lends BEMDOM */{

    /**
     * Scope
     * @type jQuery
     */
    scope : $('body'),

    /**
     * Document shortcut
     * @type jQuery
     */
    doc : doc,

    /**
     * Window shortcut
     * @type jQuery
     */
    win : win,

    /**
     * Processes a block's live properties
     * @private
     * @param {Boolean} [heedLive=false] Whether to take into account that the block already processed its live properties
     * @returns {Boolean} Whether the block is a live block
     */
    _processLive : function(heedLive) {
        var res = this._liveInitable;

        if('live' in this) {
            var noLive = typeof res === 'undefined';

            if(noLive ^ heedLive) { // should be opposite to each other
                res = this.live() !== false;

                var blockName = this.getName(),
                    origLive = this.live;

                this.live = function() {
                    return this.getName() === blockName?
                        res :
                        origLive.apply(this, arguments);
                };
            }
        }

        return res;
    },

    /**
     * Initializes blocks on a fragment of the DOM tree
     * @param {jQuery|String} [ctx=scope] Root DOM node
     * @returns {jQuery} ctx Initialization context
     */
    init : function(ctx) {
        if(typeof ctx === 'string') {
            ctx = $(ctx);
        } else if(!ctx) ctx = DOM.scope;

        var uniqInitId = identify();
        findDomElem(ctx, BEM_SELECTOR).each(function() {
            initBlocks($(this), uniqInitId);
        });

        this._runInitFns();

        return ctx;
    },

    /**
     * Destroys blocks on a fragment of the DOM tree
     * @param {jQuery} ctx Root DOM node
     * @param {Boolean} [excludeSelf=false] Exclude the main domElem
     */
    destruct : function(ctx, excludeSelf) {
        var _ctx;
        if(excludeSelf) {
            storeDomNodeParents(_ctx = ctx.children());
            ctx.empty();
        } else {
            storeDomNodeParents(_ctx = ctx);
            ctx.remove();
        }

        reverse.call(findDomElem(_ctx, BEM_SELECTOR)).each(function(_, domNode) {
            var params = getParams(domNode);
            objects.each(params, function(blockParams) {
                if(blockParams.uniqId) {
                    var block = uniqIdToBlock[blockParams.uniqId];
                    block?
                        removeDomNodeFromBlock(block, domNode) :
                        delete uniqIdToDomElems[blockParams.uniqId];
                }
            });
            delete domElemToParams[identify(domNode)];
        });

        // flush parent nodes storage that has been filled above
        domNodesToParents = {};
    },

    /**
     * Replaces a fragment of the DOM tree inside the context, destroying old blocks and intializing new ones
     * @param {jQuery} ctx Root DOM node
     * @param {jQuery|String} content New content
     * @returns {jQuery} Updated root DOM node
     */
    update : function(ctx, content) {
        this.destruct(ctx, true);
        return this.init(ctx.html(content));
    },

    /**
     * Changes a fragment of the DOM tree including the context and initializes blocks.
     * @param {jQuery} ctx Root DOM node
     * @param {jQuery|String} content Content to be added
     * @returns {jQuery} New content
     */
    replace : function(ctx, content) {
        var prev = ctx.prev(),
            parent = ctx.parent();

        content = getJqueryCollection(content);

        this.destruct(ctx);

        return this.init(prev.length?
            content.insertAfter(prev) :
            content.prependTo(parent));
    },

    /**
     * Adds a fragment of the DOM tree at the end of the context and initializes blocks
     * @param {jQuery} ctx Root DOM node
     * @param {jQuery|String} content Content to be added
     * @returns {jQuery} New content
     */
    append : function(ctx, content) {
        return this.init(getJqueryCollection(content).appendTo(ctx));
    },

    /**
     * Adds a fragment of the DOM tree at the beginning of the context and initializes blocks
     * @param {jQuery} ctx Root DOM node
     * @param {jQuery|String} content Content to be added
     * @returns {jQuery} New content
     */
    prepend : function(ctx, content) {
        return this.init(getJqueryCollection(content).prependTo(ctx));
    },

    /**
     * Adds a fragment of the DOM tree before the context and initializes blocks
     * @param {jQuery} ctx Contextual DOM node
     * @param {jQuery|String} content Content to be added
     * @returns {jQuery} New content
     */
    before : function(ctx, content) {
        return this.init(getJqueryCollection(content).insertBefore(ctx));
    },

    /**
     * Adds a fragment of the DOM tree after the context and initializes blocks
     * @param {jQuery} ctx Contextual DOM node
     * @param {jQuery|String} content Content to be added
     * @returns {jQuery} New content
     */
    after : function(ctx, content) {
        return this.init(getJqueryCollection(content).insertAfter(ctx));
    },

    /**
     * Builds a full name for a live event
     * @private
     * @param {String} e Event name
     * @returns {String}
     */
    _buildCtxEventName : function(e) {
        return this._name + ':' + e;
    },

    _liveClassBind : function(className, e, callback, invokeOnInit) {
        if(e.indexOf(' ') > -1) {
            e.split(' ').forEach(function(e) {
                this._liveClassBind(className, e, callback, invokeOnInit);
            }, this);
        } else {
            var storage = liveClassEventStorage[e],
                uniqId = identify(callback);

            if(!storage) {
                storage = liveClassEventStorage[e] = {};
                DOM.scope.bind(e, $.proxy(this._liveClassTrigger, this));
            }

            storage = storage[className] || (storage[className] = { uniqIds : {}, fns : [] });

            if(!(uniqId in storage.uniqIds)) {
                storage.fns.push({ uniqId : uniqId, fn : this._buildLiveEventFn(callback, invokeOnInit) });
                storage.uniqIds[uniqId] = storage.fns.length - 1;
            }
        }

        return this;
    },

    _liveClassUnbind : function(className, e, callback) {
        var storage = liveClassEventStorage[e];
        if(storage) {
            if(callback) {
                if(storage = storage[className]) {
                    var uniqId = identify(callback);
                    if(uniqId in storage.uniqIds) {
                        var i = storage.uniqIds[uniqId],
                            len = storage.fns.length - 1;
                        storage.fns.splice(i, 1);
                        while(i < len) storage.uniqIds[storage.fns[i++].uniqId] = i - 1;
                        delete storage.uniqIds[uniqId];
                    }
                }
            } else {
                delete storage[className];
            }
        }

        return this;
    },

    _liveClassTrigger : function(e) {
        var storage = liveClassEventStorage[e.type];
        if(storage) {
            var node = e.target, classNames = [];
            for(var className in storage) {
                classNames.push(className);
            }
            do {
                var nodeClassName = ' ' + node.className + ' ', i = 0;
                while(className = classNames[i++]) {
                    if(nodeClassName.indexOf(' ' + className + ' ') > -1) {
                        var j = 0, fns = storage[className].fns, fn, stopPropagationAndPreventDefault = false;
                        while(fn = fns[j++])
                            if(fn.fn.call($(node), e) === false) stopPropagationAndPreventDefault = true;

                        stopPropagationAndPreventDefault && e.preventDefault();
                        if(stopPropagationAndPreventDefault || e.isPropagationStopped()) return;

                        classNames.splice(--i, 1);
                    }
                }
            } while(classNames.length && (node = node.parentNode));
        }
    },

    _buildLiveEventFn : function(callback, invokeOnInit) {
        var _this = this;
        return function(e) {
            e.currentTarget = this;
            var args = [
                    _this._name,
                    $(this).closest(_this.buildSelector()),
                    undef,
                    true
                ],
                block = initBlock.apply(null, invokeOnInit? args.concat([callback, e]) : args);

            if(block && !invokeOnInit && callback)
                return callback.apply(block, arguments);
        };
    },

    /**
     * Helper for live initialization for an event on DOM elements of a block or its elements
     * @protected
     * @param {String} [elemName] Element name or names (separated by spaces)
     * @param {String} event Event name
     * @param {Function} [callback] Handler to call after successful initialization
     */
    liveInitOnEvent : function(elemName, event, callback) {
        return this.liveBindTo(elemName, event, callback, true);
    },

    /**
     * Helper for subscribing to live events on DOM elements of a block or its elements
     * @protected
     * @param {String|Object} [to] Description (object with modName, modVal, elem) or name of the element or elements (space-separated)
     * @param {String} event Event name
     * @param {Function} [callback] Handler
     */
    liveBindTo : function(to, event, callback, invokeOnInit) {
        if(!event || functions.isFunction(event)) {
            callback = event;
            event = to;
            to = undef;
        }

        if(!to || typeof to === 'string') {
            to = { elem : to };
        }

        if(to.elem && to.elem.indexOf(' ') > 0) {
            to.elem.split(' ').forEach(function(elem) {
                this._liveClassBind(
                    this.buildClass(elem, to.modName, to.modVal),
                    event,
                    callback,
                    invokeOnInit);
            }, this);
            return this;
        }

        return this._liveClassBind(
            this.buildClass(to.elem, to.modName, to.modVal),
            event,
            callback,
            invokeOnInit);
    },

    /**
     * Helper for unsubscribing from live events on DOM elements of a block or its elements
     * @protected
     * @param {String} [elem] Name of the element or elements (space-separated)
     * @param {String} event Event name
     * @param {Function} [callback] Handler
     */
    liveUnbindFrom : function(elem, event, callback) {

        if(!event || functions.isFunction(event)) {
            callback = event;
            event = elem;
            elem = undef;
        }

        if(elem && elem.indexOf(' ') > 1) {
            elem.split(' ').forEach(function(elem) {
                this._liveClassUnbind(
                    this.buildClass(elem),
                    event,
                    callback);
            }, this);
            return this;
        }

        return this._liveClassUnbind(
            this.buildClass(elem),
            event,
            callback);
    },

    /**
     * Helper for live initialization when a different block is initialized
     * @private
     * @param {String} event Event name
     * @param {String} blockName Name of the block that should trigger a reaction when initialized
     * @param {Function} callback Handler to be called after successful initialization in the new block's context
     * @param {String} findFnName Name of the method for searching
     */
    _liveInitOnBlockEvent : function(event, blockName, callback, findFnName) {
        var name = this._name;
        blocks[blockName].on(event, function(e) {
            var args = arguments,
                blocks = e.target[findFnName](name);

            callback && blocks.forEach(function(block) {
                callback.apply(block, args);
            });
        });
        return this;
    },

    /**
     * Helper for live initialization for a different block's event on the current block's DOM element
     * @protected
     * @param {String} event Event name
     * @param {String} blockName Name of the block that should trigger a reaction when initialized
     * @param {Function} callback Handler to be called after successful initialization in the new block's context
     */
    liveInitOnBlockEvent : function(event, blockName, callback) {
        return this._liveInitOnBlockEvent(event, blockName, callback, 'findBlocksOn');
    },

    /**
     * Helper for live initialization for a different block's event inside the current block
     * @protected
     * @param {String} event Event name
     * @param {String} blockName Name of the block that should trigger a reaction when initialized
     * @param {Function} [callback] Handler to be called after successful initialization in the new block's context
     */
    liveInitOnBlockInsideEvent : function(event, blockName, callback) {
        return this._liveInitOnBlockEvent(event, blockName, callback, 'findBlocksOutside');
    },

    /**
     * Adds a live event handler to a block, based on a specified element where the event will be listened for
     * @param {jQuery} [ctx] The element in which the event will be listened for
     * @param {String} e Event name
     * @param {Object} [data] Additional information that the handler gets as e.data
     * @param {Function} fn Handler
     * @param {Object} [fnCtx] Handler's context
     */
    on : function(ctx, e, data, fn, fnCtx) {
        return typeof ctx === 'object' && ctx.jquery?
            this._liveCtxBind(ctx, e, data, fn, fnCtx) :
            this.__base(ctx, e, data, fn);
    },

    /**
     * Removes the live event handler from a block, based on a specified element where the event was being listened for
     * @param {jQuery} [ctx] The element in which the event was being listened for
     * @param {String} e Event name
     * @param {Function} [fn] Handler
     * @param {Object} [fnCtx] Handler context
     */
    un : function(ctx, e, fn, fnCtx) {
        return typeof ctx === 'object' && ctx.jquery?
            this._liveCtxUnbind(ctx, e, fn, fnCtx) :
            this.__base(ctx, e, fn);
    },

    /**
     * Adds a live event handler to a block, based on a specified element where the event will be listened for
     * @private
     * @param {jQuery} ctx The element in which the event will be listened for
     * @param {String} e  Event name
     * @param {Object} [data] Additional information that the handler gets as e.data
     * @param {Function} fn Handler
     * @param {Object} [fnCtx] Handler context
     * @returns {BEMDOM} this
     */
    _liveCtxBind : function(ctx, e, data, fn, fnCtx) {
        if(typeof e === 'object') {
            if(functions.isFunction(data) || functions.isFunction(fn)) { // mod change event
                e = this._buildModEventName(e);
            } else {
                objects.each(e, function(fn, e) {
                    this._liveCtxBind(ctx, e, fn, data);
                }, this);
                return this;
            }
        }

        if(functions.isFunction(data)) {
            fnCtx = fn;
            fn = data;
            data = undef;
        }

        if(e.indexOf(' ') > -1) {
            e.split(' ').forEach(function(e) {
                this._liveCtxBind(ctx, e, data, fn, fnCtx);
            }, this);
        } else {
            var ctxE = this._buildCtxEventName(e),
                storage = liveEventCtxStorage[ctxE] ||
                    (liveEventCtxStorage[ctxE] = { counter : 0, ctxs : {} });

            ctx.each(function() {
                var ctxId = identify(this),
                    ctxStorage = storage.ctxs[ctxId];
                if(!ctxStorage) {
                    ctxStorage = storage.ctxs[ctxId] = {};
                    ++storage.counter;
                }
                ctxStorage[identify(fn) + (fnCtx? identify(fnCtx) : '')] = {
                    fn : fn,
                    data : data,
                    ctx : fnCtx
                };
            });
        }

        return this;
    },

    /**
     * Removes a live event handler from a block, based on a specified element where the event was being listened for
     * @private
     * @param {jQuery} ctx The element in which the event was being listened for
     * @param {String|Object} e Event name
     * @param {Function} [fn] Handler
     * @param {Object} [fnCtx] Handler context
     */
    _liveCtxUnbind : function(ctx, e, fn, fnCtx) {
        if(typeof e === 'object' && functions.isFunction(fn)) { // mod change event
            e = this._buildModEventName(e);
        }

        var storage = liveEventCtxStorage[e = this._buildCtxEventName(e)];

        if(storage) {
            ctx.each(function() {
                var ctxId = identify(this, true),
                    ctxStorage;
                if(ctxId && (ctxStorage = storage.ctxs[ctxId])) {
                    fn && delete ctxStorage[identify(fn) + (fnCtx? identify(fnCtx) : '')];
                    if(!fn || objects.isEmpty(ctxStorage)) {
                        storage.counter--;
                        delete storage.ctxs[ctxId];
                    }
                }
            });
            storage.counter || delete liveEventCtxStorage[e];
        }

        return this;
    },

    /**
     * Retrieves the name of an element nested in a block
     * @private
     * @param {jQuery} elem Nested element
     * @returns {String|undef}
     */
    _extractElemNameFrom : function(elem) {
        if(elem.__bemElemName) return elem.__bemElemName;

        var matches = elem[0].className.match(this._buildElemNameRE());
        return matches? matches[1] : undef;
    },

    /**
     * Builds a prefix for the CSS class of a DOM element or nested element of the block, based on modifier name
     * @private
     * @param {String} modName Modifier name
     * @param {jQuery|String} [elem] Element
     * @returns {String}
     */
    _buildModClassPrefix : function(modName, elem) {
        return this._name +
               (elem?
                   ELEM_DELIM + (typeof elem === 'string'? elem : this._extractElemNameFrom(elem)) :
                   '') +
               MOD_DELIM + modName;
    },

    /**
     * Builds a regular expression for extracting modifier values from a DOM element or nested element of a block
     * @private
     * @param {String} modName Modifier name
     * @param {jQuery|String} [elem] Element
     * @param {String} [quantifiers] Regular expression quantifiers
     * @returns {RegExp}
     */
    _buildModValRE : function(modName, elem, quantifiers) {
        return new RegExp(
            '(\\s|^)' +
            this._buildModClassPrefix(modName, elem) +
            '(?:' + MOD_DELIM + '(' + NAME_PATTERN + '))?(?=\\s|$)',
            quantifiers);
    },

    /**
     * Builds a regular expression for extracting names of elements nested in a block
     * @private
     * @returns {RegExp}
     */
    _buildElemNameRE : function() {
        return new RegExp(this._name + ELEM_DELIM + '(' + NAME_PATTERN + ')(?:\\s|$)');
    },

    /**
     * Builds a CSS class corresponding to the block/element and modifier
     * @param {String} [elem] Element name
     * @param {String} [modName] Modifier name
     * @param {String} [modVal] Modifier value
     * @returns {String}
     */
    buildClass : function(elem, modName, modVal) {
        return buildClass(this._name, elem, modName, modVal);
    },

    /**
     * Builds a CSS selector corresponding to the block/element and modifier
     * @param {String} [elem] Element name
     * @param {String} [modName] Modifier name
     * @param {String} [modVal] Modifier value
     * @returns {String}
     */
    buildSelector : function(elem, modName, modVal) {
        return '.' + this.buildClass(elem, modName, modVal);
    }
});

/**
 * Returns a block on a DOM element and initializes it if necessary
 * @param {String} blockName Block name
 * @param {Object} params Block parameters
 * @returns {BEMDOM}
 */
$.fn.bem = function(blockName, params) {
    return initBlock(blockName, this, params, true)._init();
};

provide(DOM);

});

});

(function() {

var origDefine = modules.define;

modules.define = function(name, deps, decl) {
    origDefine.apply(modules, arguments);

    name !== 'i-bem__dom_init' && arguments.length > 2 && ~deps.indexOf('i-bem__dom') &&
        modules.define('i-bem__dom_init', [name], function(provide, _, prev) {
            provide(prev);
        });
};

})();

/* end: ../../libs/bem-core/common.blocks/i-bem/__dom/i-bem__dom.js */
/* begin: ../../libs/bem-core/common.blocks/jquery/jquery.js */
/**
 * @module jquery
 * @description Provide jQuery (load if it does not exist).
 */

modules.define(
    'jquery',
    ['loader_type_js', 'jquery__config'],
    function(provide, loader, cfg) {

/* global jQuery */

function doProvide(preserveGlobal) {
    /**
     * @exports
     * @type Function
     */
    provide(preserveGlobal? jQuery : jQuery.noConflict(true));
}

typeof jQuery !== 'undefined'?
    doProvide(true) :
    loader(cfg.url, doProvide);
});

/* end: ../../libs/bem-core/common.blocks/jquery/jquery.js */
/* begin: ../../libs/bem-core/common.blocks/jquery/__config/jquery__config.js */
/**
 * @module jquery__config
 * @description Configuration for jQuery
 */

modules.define('jquery__config', function(provide) {

provide(/** @exports */{
    /**
     * URL for loading jQuery if it does not exist
     */
    url : '//yastatic.net/jquery/2.1.3/jquery.min.js'
});

});

/* end: ../../libs/bem-core/common.blocks/jquery/__config/jquery__config.js */
/* begin: ../../libs/bem-core/desktop.blocks/jquery/__config/jquery__config.js */
/**
 * @module jquery__config
 * @description Configuration for jQuery
 */

modules.define(
    'jquery__config',
    ['ua', 'objects'],
    function(provide, ua, objects, base) {

provide(
    ua.msie && parseInt(ua.version, 10) < 9?
        objects.extend(
            base,
            {
                url : '//yastatic.net/jquery/1.11.2/jquery.min.js'
            }) :
        base);

});

/* end: ../../libs/bem-core/desktop.blocks/jquery/__config/jquery__config.js */
/* begin: ../../libs/bem-core/desktop.blocks/ua/ua.js */
/**
 * @module ua
 * @description Detect some user agent features (works like jQuery.browser in jQuery 1.8)
 * @see http://code.jquery.com/jquery-migrate-1.1.1.js
 */

modules.define('ua', function(provide) {

var ua = navigator.userAgent.toLowerCase(),
    match = /(chrome)[ \/]([\w.]+)/.exec(ua) ||
        /(webkit)[ \/]([\w.]+)/.exec(ua) ||
        /(opera)(?:.*version|)[ \/]([\w.]+)/.exec(ua) ||
        /(msie) ([\w.]+)/.exec(ua) ||
        ua.indexOf('compatible') < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec(ua) ||
        [],
    matched = {
        browser : match[1] || '',
        version : match[2] || '0'
    },
    browser = {};

if(matched.browser) {
    browser[matched.browser] = true;
    browser.version = matched.version;
}

if(browser.chrome) {
    browser.webkit = true;
} else if(browser.webkit) {
    browser.safari = true;
}

/**
 * @exports
 * @type Object
 */
provide(browser);

});

/* end: ../../libs/bem-core/desktop.blocks/ua/ua.js */
/* begin: ../../libs/bem-core/common.blocks/dom/dom.js */
/**
 * @module dom
 * @description some DOM utils
 */

modules.define('dom', ['jquery'], function(provide, $) {

provide(/** @exports */{
    /**
     * Checks whether a DOM elem is in a context
     * @param {jQuery} ctx DOM elem where check is being performed
     * @param {jQuery} domElem DOM elem to check
     * @returns {Boolean}
     */
    contains : function(ctx, domElem) {
        var res = false;

        domElem.each(function() {
            var domNode = this;
            do {
                if(~ctx.index(domNode)) return !(res = true);
            } while(domNode = domNode.parentNode);

            return res;
        });

        return res;
    },

    /**
     * Returns current focused DOM elem in document
     * @returns {jQuery}
     */
    getFocused : function() {
        // "Error: Unspecified error." in iframe in IE9
        try { return $(document.activeElement); } catch(e) {}
    },

    /**
     * Checks whether a DOM element contains focus
     * @param {jQuery} domElem
     * @returns {Boolean}
     */
    containsFocus : function(domElem) {
        return this.contains(domElem, this.getFocused());
    },

    /**
    * Checks whether a browser currently can set focus on DOM elem
    * @param {jQuery} domElem
    * @returns {Boolean}
    */
    isFocusable : function(domElem) {
        var domNode = domElem[0];

        if(!domNode) return false;
        if(domNode.hasAttribute('tabindex')) return true;

        switch(domNode.tagName.toLowerCase()) {
            case 'iframe':
                return true;

            case 'input':
            case 'button':
            case 'textarea':
            case 'select':
                return !domNode.disabled;

            case 'a':
                return !!domNode.href;
        }

        return false;
    },

    /**
    * Checks whether a domElem is intended to edit text
    * @param {jQuery} domElem
    * @returns {Boolean}
    */
    isEditable : function(domElem) {
        var domNode = domElem[0];

        if(!domNode) return false;

        switch(domNode.tagName.toLowerCase()) {
            case 'input':
                var type = domNode.type;
                return (type === 'text' || type === 'password') && !domNode.disabled && !domNode.readOnly;

            case 'textarea':
                return !domNode.disabled && !domNode.readOnly;

            default:
                return domNode.contentEditable === 'true';
        }
    }
});

});

/* end: ../../libs/bem-core/common.blocks/dom/dom.js */
/* begin: ../../libs/bem-core/common.blocks/i-bem/__dom/_init/i-bem__dom_init.js */
/**
 * @module i-bem__dom_init
 */

modules.define('i-bem__dom_init', ['i-bem__dom'], function(provide, BEMDOM) {

provide(
    /**
     * Initializes blocks on a fragment of the DOM tree
     * @exports
     * @param {jQuery} [ctx=scope] Root DOM node
     * @returns {jQuery} ctx Initialization context
     */
    function(ctx) {
        return BEMDOM.init(ctx);
    });
});

/* end: ../../libs/bem-core/common.blocks/i-bem/__dom/_init/i-bem__dom_init.js */
/* begin: ../../libs/bem-components/common.blocks/button/button.js */
/**
 * @module button
 */

modules.define(
    'button',
    ['i-bem__dom', 'control', 'jquery', 'dom', 'functions', 'keyboard__codes'],
    function(provide, BEMDOM, Control, $, dom, functions, keyCodes) {

/**
 * @exports
 * @class button
 * @augments control
 * @bem
 */
provide(BEMDOM.decl({ block : this.name, baseBlock : Control }, /** @lends button.prototype */{
    beforeSetMod : {
        'pressed' : {
            'true' : function() {
                return !this.hasMod('disabled') || this.hasMod('togglable');
            }
        },

        'focused' : {
            '' : function() {
                return !this._isPointerPressInProgress;
            }
        }
    },

    onSetMod : {
        'js' : {
            'inited' : function() {
                this.__base.apply(this, arguments);
                this._isPointerPressInProgress = false;
                this._focusedByPointer = false;
            }
        },

        'disabled' : {
            'true' : function() {
                this.__base.apply(this, arguments);
                this.hasMod('togglable') || this.delMod('pressed');
            }
        },

        'focused' : {
            'true' : function() {
                this.__base.apply(this, arguments);
                this._focusedByPointer || this.setMod('focused-hard');
            },

            '' : function() {
                this.__base.apply(this, arguments);
                this.delMod('focused-hard');
            }
        }
    },

    /**
     * Returns text of the button
     * @returns {String}
     */
    getText : function() {
        return this.elem('text').text();
    },

    /**
     * Sets text to the button
     * @param {String} text
     * @returns {button} this
     */
    setText : function(text) {
        this.elem('text').text(text || '');
        return this;
    },

    _onFocus : function() {
        if(this._isPointerPressInProgress) return;

        this.__base.apply(this, arguments);
        this.bindTo('control', 'keydown', this._onKeyDown);
    },

    _onBlur : function() {
        this
            .unbindFrom('control', 'keydown', this._onKeyDown)
            .__base.apply(this, arguments);
    },

    _onPointerPress : function() {
        if(!this.hasMod('disabled')) {
            this._isPointerPressInProgress = true;
            this
                .bindToDoc('pointerrelease', this._onPointerRelease)
                .setMod('pressed');
        }
    },

    _onPointerRelease : function(e) {
        this._isPointerPressInProgress = false;
        this.unbindFromDoc('pointerrelease', this._onPointerRelease);

        if(dom.contains(this.elem('control'), $(e.target))) {
            this._focusedByPointer = true;
            this._focus();
            this._focusedByPointer = false;
            this
                ._updateChecked()
                .emit('click');
        } else {
            this._blur();
        }

        this.delMod('pressed');
    },

    _onKeyDown : function(e) {
        if(this.hasMod('disabled')) return;

        var keyCode = e.keyCode;
        if(keyCode === keyCodes.SPACE || keyCode === keyCodes.ENTER) {
            this
                .unbindFrom('control', 'keydown', this._onKeyDown)
                .bindTo('control', 'keyup', this._onKeyUp)
                ._updateChecked()
                .setMod('pressed');
        }
    },

    _onKeyUp : function(e) {
        this
            .unbindFrom('control', 'keyup', this._onKeyUp)
            .bindTo('control', 'keydown', this._onKeyDown)
            .delMod('pressed');

        e.keyCode === keyCodes.SPACE && this._doAction();

        this.emit('click');
    },

    _updateChecked : function() {
        this.hasMod('togglable') &&
            (this.hasMod('togglable', 'check')?
                this.toggleMod('checked') :
                this.setMod('checked'));

        return this;
    },

    _doAction : functions.noop
}, /** @lends button */{
    live : function() {
        this.liveBindTo('control', 'pointerpress', this.prototype._onPointerPress);
        return this.__base.apply(this, arguments);
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/button/button.js */
/* begin: ../../libs/bem-core/common.blocks/jquery/__event/_type/jquery__event_type_pointerclick.js */
/**
 * FastClick to jQuery module wrapper.
 * @see https://github.com/ftlabs/fastclick
 */
modules.define('jquery', function(provide, $) {

/**
 * FastClick: polyfill to remove click delays on browsers with touch UIs.
 *
 * @version 0.6.11
 * @copyright The Financial Times Limited [All Rights Reserved]
 * @license MIT License (see LICENSE.txt)
 */

/**
 * @class FastClick
 */

/**
 * Instantiate fast-clicking listeners on the specificed layer.
 *
 * @constructor
 * @param {Element} layer The layer to listen on
 */
function FastClick(layer) {
    'use strict';
    var oldOnClick, self = this;


    /**
     * Whether a click is currently being tracked.
     *
     * @type boolean
     */
    this.trackingClick = false;


    /**
     * Timestamp for when when click tracking started.
     *
     * @type number
     */
    this.trackingClickStart = 0;


    /**
     * The element being tracked for a click.
     *
     * @type EventTarget
     */
    this.targetElement = null;


    /**
     * X-coordinate of touch start event.
     *
     * @type number
     */
    this.touchStartX = 0;


    /**
     * Y-coordinate of touch start event.
     *
     * @type number
     */
    this.touchStartY = 0;


    /**
     * ID of the last touch, retrieved from Touch.identifier.
     *
     * @type number
     */
    this.lastTouchIdentifier = 0;


    /**
     * Touchmove boundary, beyond which a click will be cancelled.
     *
     * @type number
     */
    this.touchBoundary = 10;


    /**
     * The FastClick layer.
     *
     * @type Element
     */
    this.layer = layer;

    if (!layer || !layer.nodeType) {
        throw new TypeError('Layer must be a document node');
    }

    /** @type function() */
    this.onClick = function() { return FastClick.prototype.onClick.apply(self, arguments); };

    /** @type function() */
    this.onMouse = function() { return FastClick.prototype.onMouse.apply(self, arguments); };

    /** @type function() */
    this.onTouchStart = function() { return FastClick.prototype.onTouchStart.apply(self, arguments); };

    /** @type function() */
    this.onTouchMove = function() { return FastClick.prototype.onTouchMove.apply(self, arguments); };

    /** @type function() */
    this.onTouchEnd = function() { return FastClick.prototype.onTouchEnd.apply(self, arguments); };

    /** @type function() */
    this.onTouchCancel = function() { return FastClick.prototype.onTouchCancel.apply(self, arguments); };

    if (FastClick.notNeeded(layer)) {
        return;
    }

    // Set up event handlers as required
    if (this.deviceIsAndroid) {
        layer.addEventListener('mouseover', this.onMouse, true);
        layer.addEventListener('mousedown', this.onMouse, true);
        layer.addEventListener('mouseup', this.onMouse, true);
    }

    layer.addEventListener('click', this.onClick, true);
    layer.addEventListener('touchstart', this.onTouchStart, false);
    layer.addEventListener('touchmove', this.onTouchMove, false);
    layer.addEventListener('touchend', this.onTouchEnd, false);
    layer.addEventListener('touchcancel', this.onTouchCancel, false);

    // Hack is required for browsers that don't support Event#stopImmediatePropagation (e.g. Android 2)
    // which is how FastClick normally stops click events bubbling to callbacks registered on the FastClick
    // layer when they are cancelled.
    if (!Event.prototype.stopImmediatePropagation) {
        layer.removeEventListener = function(type, callback, capture) {
            var rmv = Node.prototype.removeEventListener;
            if (type === 'click') {
                rmv.call(layer, type, callback.hijacked || callback, capture);
            } else {
                rmv.call(layer, type, callback, capture);
            }
        };

        layer.addEventListener = function(type, callback, capture) {
            var adv = Node.prototype.addEventListener;
            if (type === 'click') {
                adv.call(layer, type, callback.hijacked || (callback.hijacked = function(event) {
                    if (!event.propagationStopped) {
                        callback(event);
                    }
                }), capture);
            } else {
                adv.call(layer, type, callback, capture);
            }
        };
    }

    // If a handler is already declared in the element's onclick attribute, it will be fired before
    // FastClick's onClick handler. Fix this by pulling out the user-defined handler function and
    // adding it as listener.
    if (typeof layer.onclick === 'function') {

        // Android browser on at least 3.2 requires a new reference to the function in layer.onclick
        // - the old one won't work if passed to addEventListener directly.
        oldOnClick = layer.onclick;
        layer.addEventListener('click', function(event) {
            oldOnClick(event);
        }, false);
        layer.onclick = null;
    }
}


/**
 * Android requires exceptions.
 *
 * @type boolean
 */
FastClick.prototype.deviceIsAndroid = navigator.userAgent.indexOf('Android') > 0;


/**
 * iOS requires exceptions.
 *
 * @type boolean
 */
FastClick.prototype.deviceIsIOS = /iP(ad|hone|od)/.test(navigator.userAgent);


/**
 * iOS 4 requires an exception for select elements.
 *
 * @type boolean
 */
FastClick.prototype.deviceIsIOS4 = FastClick.prototype.deviceIsIOS && (/OS 4_\d(_\d)?/).test(navigator.userAgent);


/**
 * iOS 6.0(+?) requires the target element to be manually derived
 *
 * @type boolean
 */
FastClick.prototype.deviceIsIOSWithBadTarget = FastClick.prototype.deviceIsIOS && (/OS ([6-9]|\d{2})_\d/).test(navigator.userAgent);


/**
 * Determine whether a given element requires a native click.
 *
 * @param {EventTarget|Element} target Target DOM element
 * @returns {boolean} Returns true if the element needs a native click
 */
FastClick.prototype.needsClick = function(target) {
    'use strict';
    switch (target.nodeName.toLowerCase()) {

    // Don't send a synthetic click to disabled inputs (issue #62)
    case 'button':
    case 'select':
    case 'textarea':
        if (target.disabled) {
            return true;
        }

        break;
    case 'input':

        // File inputs need real clicks on iOS 6 due to a browser bug (issue #68)
        if ((this.deviceIsIOS && target.type === 'file') || target.disabled) {
            return true;
        }

        break;
    case 'label':
    case 'video':
        return true;
    }

    return (/\bneedsclick\b/).test(target.className);
};


/**
 * Determine whether a given element requires a call to focus to simulate click into element.
 *
 * @param {EventTarget|Element} target Target DOM element
 * @returns {boolean} Returns true if the element requires a call to focus to simulate native click.
 */
FastClick.prototype.needsFocus = function(target) {
    'use strict';
    switch (target.nodeName.toLowerCase()) {
    case 'textarea':
        return true;
    case 'select':
        return !this.deviceIsAndroid;
    case 'input':
        switch (target.type) {
        case 'button':
        case 'checkbox':
        case 'file':
        case 'image':
        case 'radio':
        case 'submit':
            return false;
        }

        // No point in attempting to focus disabled inputs
        return !target.disabled && !target.readOnly;
    default:
        return (/\bneedsfocus\b/).test(target.className);
    }
};


/**
 * Send a click event to the specified element.
 *
 * @param {EventTarget|Element} targetElement
 * @param {Event} event
 */
FastClick.prototype.sendClick = function(targetElement, event) {
    'use strict';
    var clickEvent, touch;

    // On some Android devices activeElement needs to be blurred otherwise the synthetic click will have no effect (#24)
    if (document.activeElement && document.activeElement !== targetElement) {
        document.activeElement.blur();
    }

    touch = event.changedTouches[0];

    // Synthesise a click event, with an extra attribute so it can be tracked
    clickEvent = document.createEvent('MouseEvents');
    clickEvent.initMouseEvent(this.determineEventType(targetElement), true, true, window, 1, touch.screenX, touch.screenY, touch.clientX, touch.clientY, false, false, false, false, 0, null);
    clickEvent.forwardedTouchEvent = true;
    targetElement.dispatchEvent(clickEvent);
};

FastClick.prototype.determineEventType = function(targetElement) {
    'use strict';

    //Issue #159: Android Chrome Select Box does not open with a synthetic click event
    if (this.deviceIsAndroid && targetElement.tagName.toLowerCase() === 'select') {
        return 'mousedown';
    }

    return 'click';
};


/**
 * @param {EventTarget|Element} targetElement
 */
FastClick.prototype.focus = function(targetElement) {
    'use strict';
    var length;

    // Issue #160: on iOS 7, some input elements (e.g. date datetime) throw a vague TypeError on setSelectionRange. These elements don't have an integer value for the selectionStart and selectionEnd properties, but unfortunately that can't be used for detection because accessing the properties also throws a TypeError. Just check the type instead. Filed as Apple bug #15122724.
    if (this.deviceIsIOS && targetElement.setSelectionRange && targetElement.type.indexOf('date') !== 0 && targetElement.type !== 'time') {
        length = targetElement.value.length;
        targetElement.setSelectionRange(length, length);
    } else {
        targetElement.focus();
    }
};


/**
 * Check whether the given target element is a child of a scrollable layer and if so, set a flag on it.
 *
 * @param {EventTarget|Element} targetElement
 */
FastClick.prototype.updateScrollParent = function(targetElement) {
    'use strict';
    var scrollParent, parentElement;

    scrollParent = targetElement.fastClickScrollParent;

    // Attempt to discover whether the target element is contained within a scrollable layer. Re-check if the
    // target element was moved to another parent.
    if (!scrollParent || !scrollParent.contains(targetElement)) {
        parentElement = targetElement;
        do {
            if (parentElement.scrollHeight > parentElement.offsetHeight) {
                scrollParent = parentElement;
                targetElement.fastClickScrollParent = parentElement;
                break;
            }

            parentElement = parentElement.parentElement;
        } while (parentElement);
    }

    // Always update the scroll top tracker if possible.
    if (scrollParent) {
        scrollParent.fastClickLastScrollTop = scrollParent.scrollTop;
    }
};


/**
 * @param {EventTarget} targetElement
 * @returns {Element|EventTarget}
 */
FastClick.prototype.getTargetElementFromEventTarget = function(eventTarget) {
    'use strict';

    // On some older browsers (notably Safari on iOS 4.1 - see issue #56) the event target may be a text node.
    if (eventTarget.nodeType === Node.TEXT_NODE) {
        return eventTarget.parentNode;
    }

    return eventTarget;
};


/**
 * On touch start, record the position and scroll offset.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onTouchStart = function(event) {
    'use strict';
    var targetElement, touch, selection;

    // Ignore multiple touches, otherwise pinch-to-zoom is prevented if both fingers are on the FastClick element (issue #111).
    if (event.targetTouches.length > 1) {
        return true;
    }

    targetElement = this.getTargetElementFromEventTarget(event.target);
    touch = event.targetTouches[0];

    if (this.deviceIsIOS) {

        // Only trusted events will deselect text on iOS (issue #49)
        selection = window.getSelection();
        if (selection.rangeCount && !selection.isCollapsed) {
            return true;
        }

        if (!this.deviceIsIOS4) {

            // Weird things happen on iOS when an alert or confirm dialog is opened from a click event callback (issue #23):
            // when the user next taps anywhere else on the page, new touchstart and touchend events are dispatched
            // with the same identifier as the touch event that previously triggered the click that triggered the alert.
            // Sadly, there is an issue on iOS 4 that causes some normal touch events to have the same identifier as an
            // immediately preceeding touch event (issue #52), so this fix is unavailable on that platform.
            if (touch.identifier === this.lastTouchIdentifier) {
                event.preventDefault();
                return false;
            }

            this.lastTouchIdentifier = touch.identifier;

            // If the target element is a child of a scrollable layer (using -webkit-overflow-scrolling: touch) and:
            // 1) the user does a fling scroll on the scrollable layer
            // 2) the user stops the fling scroll with another tap
            // then the event.target of the last 'touchend' event will be the element that was under the user's finger
            // when the fling scroll was started, causing FastClick to send a click event to that layer - unless a check
            // is made to ensure that a parent layer was not scrolled before sending a synthetic click (issue #42).
            this.updateScrollParent(targetElement);
        }
    }

    this.trackingClick = true;
    this.trackingClickStart = event.timeStamp;
    this.targetElement = targetElement;

    this.touchStartX = touch.pageX;
    this.touchStartY = touch.pageY;

    // Prevent phantom clicks on fast double-tap (issue #36)
    if ((event.timeStamp - this.lastClickTime) < 200) {
        event.preventDefault();
    }

    return true;
};


/**
 * Based on a touchmove event object, check whether the touch has moved past a boundary since it started.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.touchHasMoved = function(event) {
    'use strict';
    var touch = event.changedTouches[0], boundary = this.touchBoundary;

    if (Math.abs(touch.pageX - this.touchStartX) > boundary || Math.abs(touch.pageY - this.touchStartY) > boundary) {
        return true;
    }

    return false;
};


/**
 * Update the last position.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onTouchMove = function(event) {
    'use strict';
    if (!this.trackingClick) {
        return true;
    }

    // If the touch has moved, cancel the click tracking
    if (this.targetElement !== this.getTargetElementFromEventTarget(event.target) || this.touchHasMoved(event)) {
        this.trackingClick = false;
        this.targetElement = null;
    }

    return true;
};


/**
 * Attempt to find the labelled control for the given label element.
 *
 * @param {EventTarget|HTMLLabelElement} labelElement
 * @returns {Element|null}
 */
FastClick.prototype.findControl = function(labelElement) {
    'use strict';

    // Fast path for newer browsers supporting the HTML5 control attribute
    if (labelElement.control !== undefined) {
        return labelElement.control;
    }

    // All browsers under test that support touch events also support the HTML5 htmlFor attribute
    if (labelElement.htmlFor) {
        return document.getElementById(labelElement.htmlFor);
    }

    // If no for attribute exists, attempt to retrieve the first labellable descendant element
    // the list of which is defined here: http://www.w3.org/TR/html5/forms.html#category-label
    return labelElement.querySelector('button, input:not([type=hidden]), keygen, meter, output, progress, select, textarea');
};


/**
 * On touch end, determine whether to send a click event at once.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onTouchEnd = function(event) {
    'use strict';
    var forElement, trackingClickStart, targetTagName, scrollParent, touch, targetElement = this.targetElement;

    if (!this.trackingClick) {
        return true;
    }

    // Prevent phantom clicks on fast double-tap (issue #36)
    if ((event.timeStamp - this.lastClickTime) < 200) {
        this.cancelNextClick = true;
        return true;
    }

    // Reset to prevent wrong click cancel on input (issue #156).
    this.cancelNextClick = false;

    this.lastClickTime = event.timeStamp;

    trackingClickStart = this.trackingClickStart;
    this.trackingClick = false;
    this.trackingClickStart = 0;

    // On some iOS devices, the targetElement supplied with the event is invalid if the layer
    // is performing a transition or scroll, and has to be re-detected manually. Note that
    // for this to function correctly, it must be called *after* the event target is checked!
    // See issue #57; also filed as rdar://13048589 .
    if (this.deviceIsIOSWithBadTarget) {
        touch = event.changedTouches[0];

        // In certain cases arguments of elementFromPoint can be negative, so prevent setting targetElement to null
        targetElement = document.elementFromPoint(touch.pageX - window.pageXOffset, touch.pageY - window.pageYOffset) || targetElement;
        targetElement.fastClickScrollParent = this.targetElement.fastClickScrollParent;
    }

    targetTagName = targetElement.tagName.toLowerCase();
    if (targetTagName === 'label') {
        forElement = this.findControl(targetElement);
        if (forElement) {
            this.focus(targetElement);
            if (this.deviceIsAndroid) {
                return false;
            }

            targetElement = forElement;
        }
    } else if (this.needsFocus(targetElement)) {

        // Case 1: If the touch started a while ago (best guess is 100ms based on tests for issue #36) then focus will be triggered anyway. Return early and unset the target element reference so that the subsequent click will be allowed through.
        // Case 2: Without this exception for input elements tapped when the document is contained in an iframe, then any inputted text won't be visible even though the value attribute is updated as the user types (issue #37).
        if ((event.timeStamp - trackingClickStart) > 100 || (this.deviceIsIOS && window.top !== window && targetTagName === 'input')) {
            this.targetElement = null;
            return false;
        }

        this.focus(targetElement);

        // Select elements need the event to go through on iOS 4, otherwise the selector menu won't open.
        if (!this.deviceIsIOS4 || targetTagName !== 'select') {
            this.targetElement = null;
            event.preventDefault();
        }

        return false;
    }

    if (this.deviceIsIOS && !this.deviceIsIOS4) {

        // Don't send a synthetic click event if the target element is contained within a parent layer that was scrolled
        // and this tap is being used to stop the scrolling (usually initiated by a fling - issue #42).
        scrollParent = targetElement.fastClickScrollParent;
        if (scrollParent && scrollParent.fastClickLastScrollTop !== scrollParent.scrollTop) {
            return true;
        }
    }

    // Prevent the actual click from going though - unless the target node is marked as requiring
    // real clicks or if it is in the whitelist in which case only non-programmatic clicks are permitted.
    if (!this.needsClick(targetElement)) {
        event.preventDefault();
        this.sendClick(targetElement, event);
    }

    return false;
};


/**
 * On touch cancel, stop tracking the click.
 *
 * @returns {void}
 */
FastClick.prototype.onTouchCancel = function() {
    'use strict';
    this.trackingClick = false;
    this.targetElement = null;
};


/**
 * Determine mouse events which should be permitted.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onMouse = function(event) {
    'use strict';

    // If a target element was never set (because a touch event was never fired) allow the event
    if (!this.targetElement) {
        return true;
    }

    if (event.forwardedTouchEvent) {
        return true;
    }

    // Programmatically generated events targeting a specific element should be permitted
    if (!event.cancelable) {
        return true;
    }

    // Derive and check the target element to see whether the mouse event needs to be permitted;
    // unless explicitly enabled, prevent non-touch click events from triggering actions,
    // to prevent ghost/doubleclicks.
    if (!this.needsClick(this.targetElement) || this.cancelNextClick) {

        // Prevent any user-added listeners declared on FastClick element from being fired.
        if (event.stopImmediatePropagation) {
            event.stopImmediatePropagation();
        } else {

            // Part of the hack for browsers that don't support Event#stopImmediatePropagation (e.g. Android 2)
            event.propagationStopped = true;
        }

        // Cancel the event
        event.stopPropagation();
        event.preventDefault();

        return false;
    }

    // If the mouse event is permitted, return true for the action to go through.
    return true;
};


/**
 * On actual clicks, determine whether this is a touch-generated click, a click action occurring
 * naturally after a delay after a touch (which needs to be cancelled to avoid duplication), or
 * an actual click which should be permitted.
 *
 * @param {Event} event
 * @returns {boolean}
 */
FastClick.prototype.onClick = function(event) {
    'use strict';
    var permitted;

    // It's possible for another FastClick-like library delivered with third-party code to fire a click event before FastClick does (issue #44). In that case, set the click-tracking flag back to false and return early. This will cause onTouchEnd to return early.
    if (this.trackingClick) {
        this.targetElement = null;
        this.trackingClick = false;
        return true;
    }

    // Very odd behaviour on iOS (issue #18): if a submit element is present inside a form and the user hits enter in the iOS simulator or clicks the Go button on the pop-up OS keyboard the a kind of 'fake' click event will be triggered with the submit-type input element as the target.
    if (event.target.type === 'submit' && event.detail === 0) {
        return true;
    }

    permitted = this.onMouse(event);

    // Only unset targetElement if the click is not permitted. This will ensure that the check for !targetElement in onMouse fails and the browser's click doesn't go through.
    if (!permitted) {
        this.targetElement = null;
    }

    // If clicks are permitted, return true for the action to go through.
    return permitted;
};


/**
 * Remove all FastClick's event listeners.
 *
 * @returns {void}
 */
FastClick.prototype.destroy = function() {
    'use strict';
    var layer = this.layer;

    if (this.deviceIsAndroid) {
        layer.removeEventListener('mouseover', this.onMouse, true);
        layer.removeEventListener('mousedown', this.onMouse, true);
        layer.removeEventListener('mouseup', this.onMouse, true);
    }

    layer.removeEventListener('click', this.onClick, true);
    layer.removeEventListener('touchstart', this.onTouchStart, false);
    layer.removeEventListener('touchmove', this.onTouchMove, false);
    layer.removeEventListener('touchend', this.onTouchEnd, false);
    layer.removeEventListener('touchcancel', this.onTouchCancel, false);
};


/**
 * Check whether FastClick is needed.
 *
 * @param {Element} layer The layer to listen on
 */
FastClick.notNeeded = function(layer) {
    'use strict';
    var metaViewport;

    // Devices that don't support touch don't need FastClick
    if (typeof window.ontouchstart === 'undefined') {
        return true;
    }

    if ((/Chrome\/[0-9]+/).test(navigator.userAgent)) {

        // Chrome on Android with user-scalable="no" doesn't need FastClick (issue #89)
        if (FastClick.prototype.deviceIsAndroid) {
            metaViewport = document.querySelector('meta[name=viewport]');
            if (metaViewport && metaViewport.content.indexOf('user-scalable=no') !== -1) {
                return true;
            }

        // Chrome desktop doesn't need FastClick (issue #15)
        } else {
            return true;
        }
    }

    // IE10 with -ms-touch-action: none, which disables double-tap-to-zoom (issue #97)
    if (layer.style.msTouchAction === 'none') {
        return true;
    }

    return false;
};


/**
 * Factory method for creating a FastClick object
 *
 * @param {Element} layer The layer to listen on
 */
FastClick.attach = function(layer) {
    'use strict';
    return new FastClick(layer);
};

var event = $.event.special.pointerclick = {
        setup : function() {
            $(this).on('click', event.handler);
        },

        teardown : function() {
            $(this).off('click', event.handler);
        },

        handler : function(e) {
            if(!e.button) {
                e.type = 'pointerclick';
                $.event.dispatch.apply(this, arguments);
                e.type = 'click';
            }
        }
    };

$(function() {
    FastClick.attach(document.body);
    provide($);
});

});

/* end: ../../libs/bem-core/common.blocks/jquery/__event/_type/jquery__event_type_pointerclick.js */
/* begin: ../../libs/bem-core/common.blocks/jquery/__event/_type/jquery__event_type_pointernative.js */
/*!
 * Basic pointer events polyfill
 */
;(function(global, factory) {

if(typeof modules === 'object' && modules.isDefined('jquery')) {
    modules.define('jquery', function(provide, $) {
        factory(this.global, $);
        provide($);
    });
} else if(typeof jQuery === 'function') {
    factory(global, jQuery);
}

}(this, function(window, $) {

// include "jquery-pointerevents.js"
/*!
 * Most of source code is taken from PointerEvents Polyfill
 * written by Polymer Team (https://github.com/Polymer/PointerEvents)
 * and licensed under the BSD License.
 */

var doc = document,
    USE_NATIVE_MAP = window.Map && window.Map.prototype.forEach,
    HAS_BITMAP_TYPE = window.MSPointerEvent && typeof window.MSPointerEvent.MSPOINTER_TYPE_MOUSE === 'number',
    POINTERS_FN = function() { return this.size },
    jqEvent = $.event;

// NOTE: Remove jQuery special fixes for pointerevents – we fix them ourself
delete jqEvent.special.pointerenter;
delete jqEvent.special.pointerleave;

/*!
 * Returns a snapshot of inEvent, with writable properties.
 *
 * @param {Event} event An event that contains properties to copy.
 * @returns {Object} An object containing shallow copies of `inEvent`'s
 *    properties.
 */
function cloneEvent(event) {
    var eventCopy = $.extend(new $.Event(), event);
    if(event.preventDefault) {
        eventCopy.preventDefault = function() {
            event.preventDefault();
        };
    }
    return eventCopy;
}

/*!
 * Dispatches the event to the target, taking event's bubbling into account.
 */
function dispatchEvent(event, target) {
    return event.bubbles?
        jqEvent.trigger(event, null, target) :
        jqEvent.dispatch.call(target, event);
}

var MOUSE_PROPS = {
        bubbles : false,
        cancelable : false,
        view : null,
        detail : null,
        screenX : 0,
        screenY : 0,
        clientX : 0,
        clientY : 0,
        ctrlKey : false,
        altKey : false,
        shiftKey : false,
        metaKey : false,
        button : 0,
        relatedTarget : null,
        pageX : 0,
        pageY : 0
    },
    mouseProps = Object.keys(MOUSE_PROPS),
    mousePropsLen = mouseProps.length,
    mouseDefaults = mouseProps.map(function(prop) { return MOUSE_PROPS[prop] });

/*!
 * Pointer event constructor
 *
 * @param {String} type
 * @param {Object} [params]
 * @returns {Event}
 * @constructor
 */
function PointerEvent(type, params) {
    params || (params = {});

    var e = $.Event(type);

    // define inherited MouseEvent properties
    for(var i = 0, p; i < mousePropsLen; i++) {
        p = mouseProps[i];
        e[p] = params[p] || mouseDefaults[i];
    }

    e.buttons = params.buttons || 0;

    // add x/y properties aliased to clientX/Y
    e.x = e.clientX;
    e.y = e.clientY;

    // Spec requires that pointers without pressure specified use 0.5 for down
    // state and 0 for up state.
    var pressure = 0;
    if(params.pressure) {
        pressure = params.pressure;
    } else {
        pressure = e.buttons? 0.5 : 0;
    }

    // define the properties of the PointerEvent interface
    e.pointerId = params.pointerId || 0;
    e.width = params.width || 0;
    e.height = params.height || 0;
    e.pressure = pressure;
    e.tiltX = params.tiltX || 0;
    e.tiltY = params.tiltY || 0;
    e.pointerType = params.pointerType || '';
    e.hwTimestamp = params.hwTimestamp || 0;
    e.isPrimary = params.isPrimary || false;

    // add some common jQuery properties
    e.which = typeof params.which === 'undefined'? 1 : params.which;

    return e;
}

/*!
 * Implements a map of pointer states
 * @returns {PointerMap}
 * @constructor
 */
function PointerMap() {
    if(USE_NATIVE_MAP) {
        var m = new Map();
        m.pointers = POINTERS_FN;
        return m;
    }

    this.keys = [];
    this.values = [];
}

PointerMap.prototype = {
    set : function(id, event) {
        var i = this.keys.indexOf(id);
        if(i > -1) {
            this.values[i] = event;
        } else {
            this.keys.push(id);
            this.values.push(event);
        }
    },

    has : function(id) {
        return this.keys.indexOf(id) > -1;
    },

    'delete' : function(id) {
        var i = this.keys.indexOf(id);
        if(i > -1) {
            this.keys.splice(i, 1);
            this.values.splice(i, 1);
        }
    },

    get : function(id) {
        var i = this.keys.indexOf(id);
        return this.values[i];
    },

    clear : function() {
        this.keys.length = 0;
        this.values.length = 0;
    },

    forEach : function(callback, ctx) {
        var keys = this.keys;
        this.values.forEach(function(v, i) {
            callback.call(ctx, v, keys[i], this);
        }, this);
    },

    pointers : function() {
        return this.keys.length;
    }
};

var pointermap = new PointerMap();

var dispatcher = {
    eventMap : {},
    eventSourceList : [],

    /*!
     * Add a new event source that will generate pointer events
     */
    registerSource : function(name, source) {
        var newEvents = source.events;
        if(newEvents) {
            newEvents.forEach(function(e) {
                source[e] && (this.eventMap[e] = function() { source[e].apply(source, arguments) });
            }, this);
            this.eventSourceList.push(source);
        }
    },

    register : function(element) {
        var len = this.eventSourceList.length;
        for(var i = 0, es; (i < len) && (es = this.eventSourceList[i]); i++) {
            // call eventsource register
            es.register.call(es, element);
        }
    },

    unregister : function(element) {
        var l = this.eventSourceList.length;
        for(var i = 0, es; (i < l) && (es = this.eventSourceList[i]); i++) {
            // call eventsource register
            es.unregister.call(es, element);
        }
    },

    down : function(event) {
        event.bubbles = true;
        this.fireEvent('pointerdown', event);
    },

    move : function(event) {
        event.bubbles = true;
        this.fireEvent('pointermove', event);
    },

    up : function(event) {
        event.bubbles = true;
        this.fireEvent('pointerup', event);
    },

    enter : function(event) {
        event.bubbles = false;
        this.fireEvent('pointerenter', event);
    },

    leave : function(event) {
        event.bubbles = false;
        this.fireEvent('pointerleave', event);
    },

    over : function(event) {
        event.bubbles = true;
        this.fireEvent('pointerover', event);
    },

    out : function(event) {
        event.bubbles = true;
        this.fireEvent('pointerout', event);
    },

    cancel : function(event) {
        event.bubbles = true;
        this.fireEvent('pointercancel', event);
    },

    leaveOut : function(event) {
        this.out(event);
        this.enterLeave(event, this.leave);
    },

    enterOver : function(event) {
        this.over(event);
        this.enterLeave(event, this.enter);
    },

    enterLeave : function(event, fn) {
        var target = event.target,
            relatedTarget = event.relatedTarget;

        if(!this.contains(target, relatedTarget)) {
            while(target && target !== relatedTarget) {
                event.target = target;
                fn.call(this, event);

                target = target.parentNode;
            }
        }
    },

    contains : function(target, relatedTarget) {
        return target === relatedTarget || $.contains(target, relatedTarget);
    },

    // LISTENER LOGIC
    eventHandler : function(e) {
        // This is used to prevent multiple dispatch of pointerevents from
        // platform events. This can happen when two elements in different scopes
        // are set up to create pointer events, which is relevant to Shadow DOM.
        if(e._handledByPE) {
            return;
        }

        var type = e.type, fn;
        (fn = this.eventMap && this.eventMap[type]) && fn(e);

        e._handledByPE = true;
    },

    /*!
     * Sets up event listeners
     */
    listen : function(target, events) {
        events.forEach(function(e) {
            this.addEvent(target, e);
        }, this);
    },

    /*!
     * Removes event listeners
     */
    unlisten : function(target, events) {
        events.forEach(function(e) {
            this.removeEvent(target, e);
        }, this);
    },

    addEvent : function(target, eventName) {
        $(target).on(eventName, boundHandler);
    },

    removeEvent : function(target, eventName) {
        $(target).off(eventName, boundHandler);
    },

    getTarget : function(event) {
        return event._target;
    },

    /*!
     * Creates a new Event of type `type`, based on the information in `event`
     */
    makeEvent : function(type, event) {
        var e = new PointerEvent(type, event);
        if(event.preventDefault) {
            e.preventDefault = event.preventDefault;
        }

        e._target = e._target || event.target;

        return e;
    },

    /*!
     * Dispatches the event to its target
     */
    dispatchEvent : function(event) {
        var target = this.getTarget(event);
        if(target) {
            if(!event.target) {
                event.target = target;
            }

            return dispatchEvent(event, target);
        }
    },

    /*!
     * Makes and dispatch an event in one call
     */
    fireEvent : function(type, event) {
        var e = this.makeEvent(type, event);
        return this.dispatchEvent(e);
    }
};

function boundHandler() {
    dispatcher.eventHandler.apply(dispatcher, arguments);
}

var CLICK_COUNT_TIMEOUT = 200,
    // Radius around touchend that swallows mouse events
    MOUSE_DEDUP_DIST = 25,
    MOUSE_POINTER_ID = 1,
    // This should be long enough to ignore compat mouse events made by touch
    TOUCH_DEDUP_TIMEOUT = 2500,
    // A distance for which touchmove should fire pointercancel event
    TOUCHMOVE_HYSTERESIS = 20;

// handler block for native mouse events
var mouseEvents = {
    POINTER_TYPE : 'mouse',
    events : [
        'mousedown',
        'mousemove',
        'mouseup',
        'mouseover',
        'mouseout'
    ],

    register : function(target) {
        dispatcher.listen(target, this.events);
    },

    unregister : function(target) {
        dispatcher.unlisten(target, this.events);
    },

    lastTouches : [],

    // collide with the global mouse listener
    isEventSimulatedFromTouch : function(event) {
        var lts = this.lastTouches,
            x = event.clientX,
            y = event.clientY;

        for(var i = 0, l = lts.length, t; i < l && (t = lts[i]); i++) {
            // simulated mouse events will be swallowed near a primary touchend
            var dx = Math.abs(x - t.x), dy = Math.abs(y - t.y);
            if(dx <= MOUSE_DEDUP_DIST && dy <= MOUSE_DEDUP_DIST) {
                return true;
            }
        }
    },

    prepareEvent : function(event) {
        var e = cloneEvent(event);
        e.pointerId = MOUSE_POINTER_ID;
        e.isPrimary = true;
        e.pointerType = this.POINTER_TYPE;
        return e;
    },

    mousedown : function(event) {
        if(!this.isEventSimulatedFromTouch(event)) {
            if(pointermap.has(MOUSE_POINTER_ID)) {
                // http://crbug/149091
                this.cancel(event);
            }

            pointermap.set(MOUSE_POINTER_ID, event);

            var e = this.prepareEvent(event);
            dispatcher.down(e);
        }
    },

    mousemove : function(event) {
        if(!this.isEventSimulatedFromTouch(event)) {
            var e = this.prepareEvent(event);
            dispatcher.move(e);
        }
    },

    mouseup : function(event) {
        if(!this.isEventSimulatedFromTouch(event)) {
            var p = pointermap.get(MOUSE_POINTER_ID);
            if(p && p.button === event.button) {
                var e = this.prepareEvent(event);
                dispatcher.up(e);
                this.cleanupMouse();
            }
        }
    },

    mouseover : function(event) {
        if(!this.isEventSimulatedFromTouch(event)) {
            var e = this.prepareEvent(event);
            dispatcher.enterOver(e);
        }
    },

    mouseout : function(event) {
        if(!this.isEventSimulatedFromTouch(event)) {
            var e = this.prepareEvent(event);
            dispatcher.leaveOut(e);
        }
    },

    cancel : function(inEvent) {
        var e = this.prepareEvent(inEvent);
        dispatcher.cancel(e);
        this.cleanupMouse();
    },

    cleanupMouse : function() {
        pointermap['delete'](MOUSE_POINTER_ID);
    }
};

var touchEvents = {
    events : [
        'touchstart',
        'touchmove',
        'touchend',
        'touchcancel'
    ],

    register : function(target) {
        dispatcher.listen(target, this.events);
    },

    unregister : function(target) {
        dispatcher.unlisten(target, this.events);
    },

    POINTER_TYPE : 'touch',
    clickCount : 0,
    resetId : null,
    firstTouch : null,

    isPrimaryTouch : function(touch) {
        return this.firstTouch === touch.identifier;
    },

    /*!
     * Sets primary touch if there no pointers, or the only pointer is the mouse
     */
    setPrimaryTouch : function(touch) {
        if(pointermap.pointers() === 0 ||
                (pointermap.pointers() === 1 && pointermap.has(MOUSE_POINTER_ID))) {
            this.firstTouch = touch.identifier;
            this.firstXY = { X : touch.clientX, Y : touch.clientY };
            this.scrolling = null;

            this.cancelResetClickCount();
        }
    },

    removePrimaryPointer : function(pointer) {
        if(pointer.isPrimary) {
            this.firstTouch = null;
            // TODO(@narqo): It seems that, flushing `firstXY` flag explicitly in `touchmove` handler is enough.
            // Original code from polymer doing `this.firstXY = null` on every `removePrimaryPointer` call, but looks
            // like it is harmful in some of our usecases.
            this.resetClickCount();
        }
    },

    resetClickCount : function() {
        var _this = this;
        this.resetId = setTimeout(function() {
            _this.clickCount = 0;
            _this.resetId = null;
        }, CLICK_COUNT_TIMEOUT);
    },

    cancelResetClickCount : function() {
        this.resetId && clearTimeout(this.resetId);
    },

    typeToButtons : function(type) {
        return type === 'touchstart' || type === 'touchmove'? 1 : 0;
    },

    findTarget : function(event) {
        // Currently we don't interested in shadow dom handling
        return doc.elementFromPoint(event.clientX, event.clientY);
    },

    touchToPointer : function(touch) {
        var cte = this.currentTouchEvent,
            e = cloneEvent(touch);

        // Spec specifies that pointerId 1 is reserved for Mouse.
        // Touch identifiers can start at 0.
        // Add 2 to the touch identifier for compatibility.
        e.pointerId = touch.identifier + 2;
        e.target = this.findTarget(e);
        e.bubbles = true;
        e.cancelable = true;
        e.detail = this.clickCount;
        e.button = 0;
        e.buttons = this.typeToButtons(cte.type);
        e.width = touch.webkitRadiusX || touch.radiusX || 0;
        e.height = touch.webkitRadiusY || touch.radiusY || 0;
        e.pressure = touch.mozPressure || touch.webkitForce || touch.force || 0.5;
        e.isPrimary = this.isPrimaryTouch(touch);
        e.pointerType = this.POINTER_TYPE;

        // forward touch preventDefaults
        var _this = this;
        e.preventDefault = function() {
            _this.scrolling = false;
            _this.firstXY = null;
            cte.preventDefault();
        };

        return e;
    },

    processTouches : function(event, fn) {
        var tl = event.originalEvent.changedTouches;
        this.currentTouchEvent = event;
        for(var i = 0, t; i < tl.length; i++) {
            t = tl[i];
            fn.call(this, this.touchToPointer(t));
        }
    },

    shouldScroll : function(touchEvent) {
        // return "true" for things to be much easier
        return true;
    },

    findTouch : function(touches, pointerId) {
        for(var i = 0, l = touches.length, t; i < l && (t = touches[i]); i++) {
            if(t.identifier === pointerId) {
                return true;
            }
        }
    },

    /*!
     * In some instances, a touchstart can happen without a touchend.
     * This leaves the pointermap in a broken state.
     * Therefore, on every touchstart, we remove the touches
     * that did not fire a touchend event.
     *
     * To keep state globally consistent, we fire a pointercancel
     * for this "abandoned" touch
     */
    vacuumTouches : function(touchEvent) {
        var touches = touchEvent.touches;
        // pointermap.pointers() should be less than length of touches here, as the touchstart has not
        // been processed yet.
        if(pointermap.pointers() >= touches.length) {
            var d = [];

            pointermap.forEach(function(pointer, pointerId) {
                // Never remove pointerId == 1, which is mouse.
                // Touch identifiers are 2 smaller than their pointerId, which is the
                // index in pointermap.
                if(pointerId === MOUSE_POINTER_ID || this.findTouch(touches, pointerId - 2)) return;
                d.push(pointer.outEvent);
            }, this);

            d.forEach(this.cancelOut, this);
        }
    },

    /*!
     * Prevents synth mouse events from creating pointer events
     */
    dedupSynthMouse : function(touchEvent) {
        var lts = mouseEvents.lastTouches,
            t = touchEvent.changedTouches[0];

        // only the primary finger will synth mouse events
        if(this.isPrimaryTouch(t)) {
            // remember x/y of last touch
            var lt = { x : t.clientX, y : t.clientY };
            lts.push(lt);

            setTimeout(function() {
                var i = lts.indexOf(lt);
                i > -1 && lts.splice(i, 1);
            }, TOUCH_DEDUP_TIMEOUT);
        }
    },

    touchstart : function(event) {
        var touchEvent = event.originalEvent;

        this.vacuumTouches(touchEvent);
        this.setPrimaryTouch(touchEvent.changedTouches[0]);
        this.dedupSynthMouse(touchEvent);

        if(!this.scrolling) {
            this.clickCount++;
            this.processTouches(event, this.overDown);
        }
    },

    touchmove : function(event) {
        var touchEvent = event.originalEvent;
        if(!this.scrolling) {
            if(this.scrolling === null && this.shouldScroll(touchEvent)) {
                this.scrolling = true;
            } else {
                event.preventDefault();
                this.processTouches(event, this.moveOverOut);
            }
        } else if(this.firstXY) {
            var firstXY = this.firstXY,
                touch = touchEvent.changedTouches[0],
                dx = touch.clientX - firstXY.X,
                dy = touch.clientY - firstXY.Y,
                dd = Math.sqrt(dx * dx + dy * dy);
            if(dd >= TOUCHMOVE_HYSTERESIS) {
                this.touchcancel(event);
                this.scrolling = true;
                this.firstXY = null;
            }
        }
    },

    touchend : function(event) {
        var touchEvent = event.originalEvent;
        this.dedupSynthMouse(touchEvent);
        this.processTouches(event, this.upOut);
    },

    touchcancel : function(event) {
        this.processTouches(event, this.cancelOut);
    },

    overDown : function(pEvent) {
        var target = pEvent.target;
        pointermap.set(pEvent.pointerId, {
            target : target,
            outTarget : target,
            outEvent : pEvent
        });
        dispatcher.over(pEvent);
        dispatcher.enter(pEvent);
        dispatcher.down(pEvent);
    },

    moveOverOut : function(pEvent) {
        var pointer = pointermap.get(pEvent.pointerId);

        // a finger drifted off the screen, ignore it
        if(!pointer) {
            return;
        }

        dispatcher.move(pEvent);

        var outEvent = pointer.outEvent,
            outTarget = pointer.outTarget;

        if(outEvent && outTarget !== pEvent.target) {
            pEvent.relatedTarget = outTarget;
            outEvent.relatedTarget = pEvent.target;
            // recover from retargeting by shadow
            outEvent.target = outTarget;

            if(pEvent.target) {
                dispatcher.leaveOut(outEvent);
                dispatcher.enterOver(pEvent);
            } else {
                // clean up case when finger leaves the screen
                pEvent.target = outTarget;
                pEvent.relatedTarget = null;
                this.cancelOut(pEvent);
            }
        }

        pointer.outEvent = pEvent;
        pointer.outTarget = pEvent.target;
    },

    upOut : function(pEvent) {
        dispatcher.up(pEvent);
        dispatcher.out(pEvent);
        dispatcher.leave(pEvent);

        this.cleanUpPointer(pEvent);
    },

    cancelOut : function(pEvent) {
        dispatcher.cancel(pEvent);
        dispatcher.out(pEvent);
        dispatcher.leave(pEvent);
        this.cleanUpPointer(pEvent);
    },

    cleanUpPointer : function(pEvent) {
        pointermap['delete'](pEvent.pointerId);
        this.removePrimaryPointer(pEvent);
    }
};

var msEvents = {
    events : [
        'MSPointerDown',
        'MSPointerMove',
        'MSPointerUp',
        'MSPointerOut',
        'MSPointerOver',
        'MSPointerCancel'
    ],

    register : function(target) {
        dispatcher.listen(target, this.events);
    },

    unregister : function(target) {
        dispatcher.unlisten(target, this.events);
    },

    POINTER_TYPES : [
        '',
        'unavailable',
        'touch',
        'pen',
        'mouse'
    ],

    prepareEvent : function(event) {
        var e = cloneEvent(event);
        HAS_BITMAP_TYPE && (e.pointerType = this.POINTER_TYPES[event.pointerType]);
        return e;
    },

    MSPointerDown : function(event) {
        pointermap.set(event.pointerId, event);
        var e = this.prepareEvent(event);
        dispatcher.down(e);
    },

    MSPointerMove : function(event) {
        var e = this.prepareEvent(event);
        dispatcher.move(e);
    },

    MSPointerUp : function(event) {
        var e = this.prepareEvent(event);
        dispatcher.up(e);
        this.cleanup(event.pointerId);
    },

    MSPointerOut : function(event) {
        var e = this.prepareEvent(event);
        dispatcher.leaveOut(e);
    },

    MSPointerOver : function(event) {
        var e = this.prepareEvent(event);
        dispatcher.enterOver(e);
    },

    MSPointerCancel : function(event) {
        var e = this.prepareEvent(event);
        dispatcher.cancel(e);
        this.cleanup(event.pointerId);
    },

    cleanup : function(id) {
        pointermap['delete'](id);
    }
};

var navigator = window.navigator;
if(navigator.msPointerEnabled) {
    dispatcher.registerSource('ms', msEvents);
} else {
    dispatcher.registerSource('mouse', mouseEvents);
    if(typeof window.ontouchstart !== 'undefined') {
        dispatcher.registerSource('touch', touchEvents);
    }
}

dispatcher.register(doc);

}));

/* end: ../../libs/bem-core/common.blocks/jquery/__event/_type/jquery__event_type_pointernative.js */
/* begin: ../../libs/bem-core/common.blocks/keyboard/__codes/keyboard__codes.js */
/**
 * @module keyboard__codes
 */
modules.define('keyboard__codes', function(provide) {

provide(/** @exports */{
    BACKSPACE : 8,
    TAB : 9,
    ENTER : 13,
    CAPS_LOCK : 20,
    ESC : 27,
    SPACE : 32,
    PAGE_UP : 33,
    PAGE_DOWN : 34,
    END : 35,
    HOME : 36,
    LEFT : 37,
    UP : 38,
    RIGHT : 39,
    DOWN : 40,
    INSERT : 41,
    DELETE : 42
});

});

/* end: ../../libs/bem-core/common.blocks/keyboard/__codes/keyboard__codes.js */
/* begin: ../../libs/bem-components/common.blocks/control/control.js */
/**
 * @module control
 */

modules.define(
    'control',
    ['i-bem__dom', 'dom', 'next-tick'],
    function(provide, BEMDOM, dom, nextTick) {

/**
 * @exports
 * @class control
 * @abstract
 * @bem
 */
provide(BEMDOM.decl(this.name, /** @lends control.prototype */{
    beforeSetMod : {
        'focused' : {
            'true' : function() {
                return !this.hasMod('disabled');
            }
        }
    },

    onSetMod : {
        'js' : {
            'inited' : function() {
                this._focused = dom.containsFocus(this.elem('control'));
                this._focused?
                    // if control is already in focus, we need to force _onFocus
                    this._onFocus() :
                    // if block already has focused mod, we need to focus control
                    this.hasMod('focused') && this._focus();

                this._tabIndex = this.elem('control').attr('tabindex');
                if(this.hasMod('disabled') && this._tabIndex !== 'undefined')
                    this.elem('control').removeAttr('tabindex');
            }
        },

        'focused' : {
            'true' : function() {
                this._focused || this._focus();
            },

            '' : function() {
                this._focused && this._blur();
            }
        },

        'disabled' : {
            '*' : function(modName, modVal) {
                this.elem('control').prop(modName, !!modVal);
            },

            'true' : function() {
                this.delMod('focused');
                typeof this._tabIndex !== 'undefined' &&
                    this.elem('control').removeAttr('tabindex');
            },

            '' : function() {
                typeof this._tabIndex !== 'undefined' &&
                    this.elem('control').attr('tabindex', this._tabIndex);
            }
        }
    },

    /**
     * Returns name of control
     * @returns {String}
     */
    getName : function() {
        return this.elem('control').attr('name') || '';
    },

    /**
     * Returns control value
     * @returns {String}
     */
    getVal : function() {
        return this.elem('control').val();
    },

    _onFocus : function() {
        this._focused = true;
        this.setMod('focused');
    },

    _onBlur : function() {
        this._focused = false;
        this.delMod('focused');
    },

    _focus : function() {
        dom.isFocusable(this.elem('control'))?
            this.elem('control').focus() :
            this._onFocus(); // issues/1456
    },

    _blur : function() {
        dom.isFocusable(this.elem('control'))?
            this.elem('control').blur() :
            this._onBlur();
    }
}, /** @lends control */{
    live : function() {
        this
            .liveBindTo('control', 'focusin', function() {
                this._focused || this._onFocus(); // to prevent double call of _onFocus in case of init by focus
            })
            .liveBindTo('control', 'focusout', this.prototype._onBlur);

        var focused = dom.getFocused();
        if(focused.hasClass(this.buildClass('control'))) {
            var _this = this; // TODO: https://github.com/bem/bem-core/issues/425
            nextTick(function() {
                if(focused[0] === dom.getFocused()[0]) {
                    var block = focused.closest(_this.buildSelector());
                    block && block.bem(_this.getName());
                }
            });
        }
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/control/control.js */
/* begin: ../../libs/bem-components/desktop.blocks/control/control.js */
/** @module control */

modules.define(
    'control',
    function(provide, Control) {

provide(Control.decl({
    beforeSetMod : {
        'hovered' : {
            'true' : function() {
                return !this.hasMod('disabled');
            }
        }
    },

    onSetMod : {
        'disabled' : {
            'true' : function() {
                this.__base.apply(this, arguments);
                this.delMod('hovered');
            }
        },

        'hovered' : {
            'true' : function() {
                this.bindTo('mouseleave', this._onMouseLeave);
            },

            '' : function() {
                this.unbindFrom('mouseleave', this._onMouseLeave);
            }
        }
    },

    _onMouseOver : function() {
        this.setMod('hovered');
    },

    _onMouseLeave : function() {
        this.delMod('hovered');
    }
}, {
    live : function() {
        return this
            .liveBindTo('mouseover', this.prototype._onMouseOver)
            .__base.apply(this, arguments);
    }
}));

});

/* end: ../../libs/bem-components/desktop.blocks/control/control.js */
/* begin: ../../common.blocks/board/board.js */
modules.define('board', ['i-bem__dom', 'jquery', 'api__airport-status', 'objects'],
    function (provide, BEMDOM, $, AirportStatusClass, Objects) {
        provide(
            BEMDOM.decl(
                this.name, {
                    onSetMod: {
                        'js': {
                            'inited': function () {
                                var _self = this,
                                    controlsBlock = this.findBlockInside('controls'),
                                    params = controlsBlock.getValues(),
                                    spinBlock = this.findBlockInside('spin'),
                                    gridBlock = this.findBlockInside('grid'),
                                    AirportStatus = new AirportStatusClass(params);

                                AirportStatus.on("loading", function () {
                                    spinBlock.setMod('visible', true);
                                    gridBlock.setMod('loading', true);
                                });

                                AirportStatus.on("complete", function () {
                                    spinBlock.setMod('visible', false);
                                    gridBlock.setMod('loading', false);
                                });

                                function getAirportStatus(params) {
                                    AirportStatus.get(params).done(function (data) {
                                        gridBlock.update(null,
                                            Objects.extend(data, AirportStatus.getParams())
                                        );
                                    });
                                };

                                getAirportStatus();

                                controlsBlock.on('change', function (e, params) {
                                    _self.scrollToDocStart(function () {
                                        getAirportStatus(params);
                                    });
                                });
                            }
                        }
                    },
                    scrollToDocStart: function (onComplete) {
                        this.findBlockOutside('page')
                            .domElem.animate({scrollTop: 0}, {
                                duration: 600,
                                complete: onComplete
                            });
                    },
                    bindToDocScroll: function () {
                        var controlsBlock = this.findBlockInside('controls').domElem,
                            gridHead = this.findBlockInside('grid').findElem('head'),
                            gridContent = this.findBlockInside('grid').findElem('content');

                        this.bindToDoc('scroll', function (e) {
                            var documentScrollTop = $(e.target).scrollTop(), scrollDist = 30;

                            gridHead.toggleClass('grid__head_scrolled', documentScrollTop > scrollDist);

                            gridContent.toggleClass('grid__content_scrolled',
                                documentScrollTop > scrollDist);

                            controlsBlock.toggleClass('controls_scrolled', documentScrollTop > scrollDist);
                        });
                    },
                    unbindFromDocScroll: function () {
                        this.unbindFromDoc('scroll');
                    }
                }
            )
        );
    }
);

/* end: ../../common.blocks/board/board.js */
/* begin: ../../common.blocks/api/__airport-status/api__airport-status.js */
modules.define('api__airport-status', ['jquery', 'inherit', 'events__channels', 'vow', 'objects', 'querystring'],
    function (provide, $, inherit, channels, vow, Objects, querystring) {
        provide(
            inherit({
                __constructor: function (params) {
                    this._params = {};
                    if (Object.prototype.toString.call(params).indexOf('Object') !== -1) {
                        Objects.extend(this._params, params);
                    }
                    this._events = channels(this.name);
                },
                on: function (eventName, handler) {
                    this._events.on(eventName, handler);
                },
                /**
                 *
                 * @param params {Object}
                 * @param {string} params.airport - 'DME' or 'SVO'
                 * @param {string} employee.mode - 'dep' or 'arr'
                 * @returns {Promise}
                 */
                get: function (params) {

                    if (params == null && this._data != null) {
                        return vow.cast(this._data);
                    }

                    if (Object.prototype.toString.call(params).indexOf('Object') !== -1) {
                        Objects.extend(this._params, params);
                    }

                    if (!this._params.airport || !this._params.mode) {
                        return vow.cast();
                    }

                    var _self = this,
                        defer = vow.defer(),
                        promise = defer.promise(),
                        moment = new Date(),
                        url = "https://api.flightstats.com/flex/flightstatus/rest/v2/jsonp/airport/status",
                        params = {
                            appId: "d5e230bb",
                            appKey: "d83a11ada64132698b2b20f4b908762b",
                            includeFlightPlan: false,
                            numHours: 5,
                            maxFlights: 50
                        };

                    if (false && window.airportStatusData != null) { //Try to request ajax. Resolve with saved data on error.
                        _self._events.emit("loading");
                        setTimeout(function () {
                                _self._events.emit("complete");
                                defer.resolve(window.airportStatusData);
                            }, Math.round(Math.random * 2000)
                        );
                    } else {
                        $
                            .ajax({
                                dataType: "jsonp",
                                url: [
                                         url,
                                         this._params.airport,
                                         this._params.mode,
                                         moment.getFullYear(),
                                         moment.getMonth() + 1,
                                         moment.getDate(),
                                         moment.getHours()
                                     ].join("/") + "?" + querystring.stringify(params),
                                beforeSend: function () {
                                    _self._events.emit("loading");
                                }
                            })
                            .done(function (data) {
                                if (data.error) {
                                    return defer.resolve(window.airportStatusData);
                                }
                                defer.resolve(data);
                            })
                            .fail(function (reason) {
                                //If error, resolve with saved data. For demo purposes.
                                //defer.reject(reason);
                                defer.resolve(window.airportStatusData);
                            })
                            .always(function () {
                                _self._events.emit("complete");
                            });
                    }

                    promise.done(function (data) {
                        this._data = data;
                    });

                    return promise;
                },
                getParams: function () {
                    return this._params;
                }
            })
        );
    }
);

/* end: ../../common.blocks/api/__airport-status/api__airport-status.js */
/* begin: ../../libs/bem-components/common.blocks/radio-group/radio-group.js */
/**
 * @module radio-group
 */

modules.define(
    'radio-group',
    ['i-bem__dom', 'jquery', 'dom', 'radio'],
    function(provide, BEMDOM, $, dom) {

var undef;
/**
 * @exports
 * @class radio-group
 * @bem
 */
provide(BEMDOM.decl(this.name, /** @lends radio-group.prototype */{
    beforeSetMod : {
        'focused' : {
            'true' : function() {
                return !this.hasMod('disabled');
            }
        }
    },

    onSetMod : {
        'js' : {
            'inited' : function() {
                this._checkedRadio = this.findBlockInside({
                    block : 'radio',
                    modName : 'checked',
                    modVal : true
                });

                this._inSetVal = false;
                this._val = this._checkedRadio? this._checkedRadio.getVal() : undef;
                this._radios = undef;
            }
        },

        'disabled' : function(modName, modVal) {
            this.getRadios().forEach(function(option) {
                option.setMod(modName, modVal);
            });
        },

        'focused' : {
            'true' : function() {
                if(dom.containsFocus(this.domElem)) return;

                var radios = this.getRadios(),
                    i = 0, radio;

                while(radio = radios[i++]) {
                    if(radio.setMod('focused').hasMod('focused')) { // we need to be sure that radio has got focus
                        return;
                    }
                }
            },

            '' : function() {
                var focusedRadio = this.findBlockInside({
                        block : 'radio',
                        modName : 'focused',
                        modVal : true
                    });

                focusedRadio && focusedRadio.delMod('focused');
            }
        }
    },

    /**
     * Returns control value
     * @returns {String}
     */
    getVal : function() {
        return this._val;
    },

    /**
     * Sets control value
     * @param {String} val value
     * @param {Object} [data] additional data
     * @returns {radio-group} this
     */
    setVal : function(val, data) {
        var isValUndef = val === undef;

        isValUndef || (val = String(val));

        if(this._val !== val) {
            if(isValUndef) {
                this._val = undef;
                this._checkedRadio.delMod('checked');
                this.emit('change', data);
            } else {
                var radio = this._getRadioByVal(val);
                if(radio) {
                    this._inSetVal = true;

                    this._val !== undef && this._getRadioByVal(this._val).delMod('checked');
                    this._val = radio.getVal();
                    radio.setMod('checked');

                    this._inSetVal = false;
                    this.emit('change', data);
                }
            }
        }

        return this;
    },

    /**
     * Returns name of control
     * @returns {String}
     */
    getName : function() {
        return this.getRadios()[0].getName();
    },

    /**
     * Returns options
     * @returns {radio[]}
     */
    getRadios : function() {
        return this._radios || (this._radios = this.findBlocksInside('radio'));
    },

    _getRadioByVal : function(val) {
        var radios = this.getRadios(),
            i = 0, option;

        while(option = radios[i++]) {
            if(option.getVal() === val) {
                return option;
            }
        }
    },

    _onRadioCheck : function(e) {
        var radioVal = (this._checkedRadio = e.target).getVal();
        if(!this._inSetVal) {
            if(this._val === radioVal) {
                // on block init value set in constructor, we need remove old checked and emit "change" event
                this.getRadios().forEach(function(radio) {
                    radio.getVal() !== radioVal && radio.delMod('checked');
                });
                this.emit('change');
            } else {
                this.setVal(radioVal);
            }
        }
    },

    _onRadioFocus : function(e) {
        this.setMod('focused', e.target.getMod('focused'));
    }
}, /** @lends radio-group */{
    live : function() {
        var ptp = this.prototype;
        this
            .liveInitOnBlockInsideEvent(
                { modName : 'checked', modVal : true },
                'radio',
                ptp._onRadioCheck)
            .liveInitOnBlockInsideEvent(
                { modName : 'focused', modVal : '*' },
                'radio',
                ptp._onRadioFocus);
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/radio-group/radio-group.js */
/* begin: ../../libs/bem-components/common.blocks/radio/radio.js */
/**
 * @module radio
 */

modules.define(
    'radio',
    ['i-bem__dom', 'control'],
    function(provide, BEMDOM, Control) {

/**
 * @exports
 * @class radio
 * @augments control
 * @bem
 */
provide(BEMDOM.decl({ block : this.name, baseBlock : Control }, /** @lends radio.prototype */{
    onSetMod : {
        'checked' : function(modName, modVal) {
            this.elem('control').prop(modName, modVal);
        }
    },

    _onChange : function() {
        this.hasMod('disabled') || this.setMod('checked');
    }
}, /** @lends radio */{
    live : function() {
        this.liveBindTo('change', this.prototype._onChange);
        return this.__base.apply(this, arguments);
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/radio/radio.js */
/* begin: ../../common.blocks/grid/grid.js */
modules.define(
    'grid',
    ['i-bem__dom', 'jquery', 'bh', 'controls'],
    function (provide, BEMDOM, $, BH, Controls) {
        provide(BEMDOM.decl(this.name, {
            onSetMod: {
                'js': {
                    'inited': function () {
                        Controls.on("dataLoaded", this.update, this);
                    }
                }
            },
            update: function (e, data) {
                this._data = data;
                var processedData = this.processData(data);
                this.setData(processedData);
            },
            processData: function (data) {
                var rows = [],
                    row = {},
                    statusMap = {
                        A: 'Active',
                        C: 'Canceled',
                        D: 'Diverted',
                        DN: 'Data source needed',
                        L: 'Landed',
                        NO: 'Not Operational',
                        R: 'Redirected',
                        S: 'Scheduled',
                        U: 'Unknown'
                    };

                function getAirline(fsCode) {
                    var airline = {};
                    data.appendix.airlines.forEach(function (item) {
                        if (item.fs != fsCode) {
                            return;
                        }
                        airline = item;
                    });
                    return airline;
                }

                function getAirport(fsCode) {
                    var airport = {};
                    data.appendix.airports.forEach(function (item) {
                        if (item.fs != fsCode) {
                            return;
                        }
                        airport = item;
                    });
                    return airport;
                }

                function getEquipment(iata) {
                    var equipment = {};
                    data.appendix.equipments.forEach(function (item) {
                        if (item.iata != iata) {
                            return;
                        }
                        equipment = item;
                    });
                    return equipment;
                }

                data.flightStatuses.forEach(function (item) {
                    row = {};
                    row.mode = data.mode;
                    row.flightNumber = item.flightNumber;
                    row.depAirport = getAirport(item.departureAirportFsCode).name;
                    row.arrAirport = getAirport(item.arrivalAirportFsCode).name;
                    row.airline = getAirline(item.carrierFsCode);
                    if (item.flightEquipment) {
                        row.equipment = getEquipment(item.flightEquipment.scheduledEquipmentIataCode).name;
                    }
                    row.depTime = item.departureDate.dateLocal;
                    row.arrTime = item.arrivalDate.dateLocal;
                    row.status = statusMap[item.status];
                    row.delays = item.delays;
                    rows.push(row);
                });
                return rows;
            },
            setData: function (data) {
                var _self = this,
                    boardBlock = this.findBlockOutside('board');

                boardBlock.unbindFromDocScroll();

                BEMDOM.update(this.domElem,
                    BH.apply([
                        {
                            block: 'grid',
                            elem: 'head',
                            mode: _self._data.mode
                        },
                        {
                            block: 'grid',
                            elem: 'content',
                            rows: data
                        }
                    ])
                );

                _self.toggleMod('empty', 'no', 'yes', data.length > 0);
                boardBlock.bindToDocScroll();
            }
        }));
    }
);

/* end: ../../common.blocks/grid/grid.js */
/* begin: ../../libs/bem-components/common.blocks/popup/popup.js */
/**
 * @module popup
 */

modules.define(
    'popup',
    ['i-bem__dom'],
    function(provide, BEMDOM) {

var ZINDEX_FACTOR = 1000,
    visiblePopupsZIndexes = {},
    undef;

/**
 * @exports
 * @class popup
 * @bem
 *
 * @param {Number} [zIndexGroupLevel=0] z-index group level
 *
 * @bemmod visible Represents visible state
 */
provide(BEMDOM.decl(this.name, /** @lends popup.prototype */{
    onSetMod : {
        'js' : {
            'inited' : function() {
                this._parentPopup = undef;
                this._zIndex = null;
                this._zIndexGroupLevel = null;
                this._isAttachedToScope = false;
            },

            '' : function() {
                this.delMod('visible');
            }
        },

        'visible' : {
            'true' : function() {
                if(!this._isAttachedToScope) {
                    BEMDOM.scope.append(this.domElem);
                    this._isAttachedToScope = true;
                }

                this
                    ._captureZIndex()
                    ._bindToParentPopup()
                    .bindTo('pointerpress pointerclick', this._setPreventHideByClick);
            },

            '' : function() {
                this
                    ._releaseZIndex()
                    ._unbindFromParentPopup()
                    .unbindFrom('pointerpress pointerclick', this._setPreventHideByClick);
            }
        }
    },

    /**
     * Sets content
     * @param {String|jQuery} content
     * @returns {popup} this
     */
    setContent : function(content) {
        BEMDOM.update(this.domElem, content);
        return this;
    },

    _calcZIndexGroupLevel : function() {
        var res = this.params.zIndexGroupLevel,
            parentPopup = this._getParentPopup();

        parentPopup && (res += parentPopup._zIndexGroupLevel);

        return res;
    },

    _setPreventHideByClick : function() {
        var curPopup = this;
        do {
            curPopup._preventHideByClick = true;
        } while(curPopup = curPopup._getParentPopup());
    },

    _bindToParentPopup : function() {
        var parentPopup = this._getParentPopup();
        parentPopup && parentPopup.on({ modName : 'visible', modVal : '' }, this._onParentPopupHide, this);

        return this;
    },

    _unbindFromParentPopup : function() {
        this._parentPopup && this._parentPopup.un({ modName : 'visible', modVal : '' }, this._onParentPopupHide, this);
        this._parentPopup = undef;

        return this;
    },

    _onParentPopupHide : function() {
        this.delMod('visible');
    },

    _getParentPopup : function() {
        return this._parentPopup;
    },

    _captureZIndex : function() {
        var level = this._zIndexGroupLevel === null?
                this._zIndexGroupLevel = this._calcZIndexGroupLevel() :
                this._zIndexGroupLevel,
            zIndexes = visiblePopupsZIndexes[level] || (visiblePopupsZIndexes[level] = [(level + 1) * ZINDEX_FACTOR]),
            prevZIndex = this._zIndex;

        this._zIndex = zIndexes[zIndexes.push(zIndexes[zIndexes.length - 1] + 1) - 1];
        this._zIndex !== prevZIndex && this.domElem.css('z-index', this._zIndex);

        return this;
    },

    _releaseZIndex : function() {
        var zIndexes = visiblePopupsZIndexes[this._zIndexGroupLevel];
        zIndexes.splice(zIndexes.indexOf(this._zIndex), 1);

        return this;
    },

    _recaptureZIndex : function() {
        this._releaseZIndex();
        this._zIndexGroupLevel = null;

        return this._captureZIndex();
    },

    getDefaultParams : function() {
        return {
            zIndexGroupLevel : 0
        };
    }
}, /** @lends popup */{
    live : true
}));

});

/* end: ../../libs/bem-components/common.blocks/popup/popup.js */
/* begin: ../../libs/bem-components/common.blocks/popup/_target/popup_target.js */
/**
 * @module popup
 */

modules.define(
    'popup',
    ['i-bem__dom', 'objects'],
    function(provide, BEMDOM, objects, Popup) {

var VIEWPORT_ACCURACY_FACTOR = 0.99,
    DEFAULT_DIRECTIONS = [
        'bottom-left', 'bottom-center', 'bottom-right',
        'top-left', 'top-center', 'top-right',
        'right-top', 'right-center', 'right-bottom',
        'left-top', 'left-center', 'left-bottom'
    ],

    win = BEMDOM.win,
    undef;

/**
 * @exports
 * @class popup
 * @bem
 *
 * @param {Number} [mainOffset=0] offset along the main direction
 * @param {Number} [secondaryOffset=0] offset along the secondary direction
 * @param {Number} [viewportOffset=0] offset from the viewport (window)
 * @param {Array[String]} [directions] allowed directions
 */
provide(Popup.decl({ modName : 'target' }, /** @lends popup.prototype */{
    onSetMod : {
        'js' : {
            'inited' : function() {
                this.__base.apply(this, arguments);

                this._lastDrawingCss = {
                    left : undef,
                    top : undef,
                    zIndex : undef,
                    display : undef
                };
            }
        },

        'visible' : {
            'true' : function() {
                this.__base.apply(this, arguments);
                this
                    .bindToWin('scroll resize', this._onWinScrollAndResize)
                    .redraw();
            },

            '' : function() {
                this.__base.apply(this, arguments);
                this.unbindFromWin('scroll resize', this._onWinScrollAndResize);
            }
        }
    },

    /**
     * @override
     */
    setContent : function() {
        return this.__base.apply(this, arguments).redraw();
    },

    /**
     * Redraws popup
     * @returns {popup} this
     */
    redraw : function() {
        if(!this.hasMod('visible')) return this;

        var bestDrawingParams = this._calcBestDrawingParams();

        this.setMod('direction', bestDrawingParams.direction);

        var lastDrawingCss = this._lastDrawingCss,
            needUpdateCss = false;

        objects.each(
            this._calcDrawingCss(bestDrawingParams),
            function(val, name) {
                if(lastDrawingCss[name] !== val) {
                    lastDrawingCss[name] = val;
                    needUpdateCss = true;
                }
            });

        needUpdateCss && this.domElem.css(lastDrawingCss);

        return this;
    },

    _calcDrawingCss : function(drawingParams) {
        return {
            left : drawingParams.left,
            top : drawingParams.top
        };
    },

    /**
     * Returns possible directions to draw with max available width and height.
     * @returns {Array}
     */
    calcPossibleDrawingParams : function() {
        var target = this._calcTargetDimensions(),
            viewport = this._calcViewportDimensions(),
            params = this.params,
            mainOffset = params.mainOffset,
            secondaryOffset = params.secondaryOffset,
            viewportOffset = params.viewportOffset;

        return this.params.directions.map(function(direction) {
            var subRes = {
                    direction : direction,
                    width : 0,
                    height : 0,
                    left : 0,
                    top : 0
                };

            if(this._checkMainDirection(direction, 'bottom')) {
                subRes.top = target.top + target.height + mainOffset;
                subRes.height = viewport.bottom - subRes.top - viewportOffset;
            } else if(this._checkMainDirection(direction, 'top')) {
                subRes.height = target.top - viewport.top - mainOffset - viewportOffset;
                subRes.top = target.top - subRes.height - mainOffset;
            } else {
                if(this._checkSecondaryDirection(direction, 'center')) {
                    subRes.height = viewport.bottom - viewport.top - 2 * viewportOffset;
                    subRes.top = target.top + target.height / 2 - subRes.height / 2;
                } else if(this._checkSecondaryDirection(direction, 'bottom')) {
                    subRes.height = target.top + target.height - viewport.top - secondaryOffset - viewportOffset;
                    subRes.top = target.top + target.height - subRes.height - secondaryOffset;
                } else if(this._checkSecondaryDirection(direction, 'top')) {
                    subRes.top = target.top + secondaryOffset;
                    subRes.height = viewport.bottom - subRes.top - viewportOffset;
                }

                if(this._checkMainDirection(direction, 'left')) {
                    subRes.width = target.left - viewport.left - mainOffset - viewportOffset;
                    subRes.left = target.left - subRes.width - mainOffset;
                } else {
                    subRes.left = target.left + target.width + mainOffset;
                    subRes.width = viewport.right - subRes.left - viewportOffset;
                }
            }

            if(this._checkSecondaryDirection(direction, 'right')) {
                subRes.width = target.left + target.width - viewport.left - secondaryOffset - viewportOffset;
                subRes.left = target.left + target.width - subRes.width - secondaryOffset;
            } else if(this._checkSecondaryDirection(direction, 'left')) {
                subRes.left = target.left + secondaryOffset;
                subRes.width = viewport.right - subRes.left - viewportOffset;
            } else if(this._checkSecondaryDirection(direction, 'center')) {
                if(this._checkMainDirection(direction, 'top', 'bottom')) {
                    subRes.width = viewport.right - viewport.left - 2 * viewportOffset;
                    subRes.left = target.left + target.width / 2 - subRes.width / 2;
                }
            }

            return subRes;
        }, this);
    },

    _calcBestDrawingParams : function() {
        var popup = this._calcPopupDimensions(),
            target = this._calcTargetDimensions(),
            viewport = this._calcViewportDimensions(),
            directions = this.params.directions,
            i = 0,
            direction,
            pos,
            viewportFactor,
            bestDirection,
            bestPos,
            bestViewportFactor;

        while(direction = directions[i++]) {
            pos = this._calcPos(direction, target, popup);
            viewportFactor = this._calcViewportFactor(pos, viewport, popup);
            if(i === 1 ||
                    viewportFactor > bestViewportFactor ||
                    (!bestViewportFactor && this.hasMod('direction', direction))) {
                bestDirection = direction;
                bestViewportFactor = viewportFactor;
                bestPos = pos;
            }
            if(bestViewportFactor > VIEWPORT_ACCURACY_FACTOR) break;
        }

        return {
            direction : bestDirection,
            left : bestPos.left,
            top : bestPos.top
        };
    },

    _calcPopupDimensions : function() {
        var popupWidth = this.domElem.outerWidth(),
            popupHeight = this.domElem.outerHeight();

        return {
            width : popupWidth,
            height : popupHeight,
            area : popupWidth * popupHeight
        };
    },

    /**
     * @abstract
     * @protected
     * @returns {Object}
     */
    _calcTargetDimensions : function() {},

    _calcViewportDimensions : function() {
        var winTop = win.scrollTop(),
            winLeft = win.scrollLeft(),
            winWidth = win.width(),
            winHeight = win.height();

        return {
            top : winTop,
            left : winLeft,
            bottom : winTop + winHeight,
            right : winLeft + winWidth
        };
    },

    _calcPos : function(direction, target, popup) {
        var res = {},
            mainOffset = this.params.mainOffset,
            secondaryOffset = this.params.secondaryOffset;

        if(this._checkMainDirection(direction, 'bottom')) {
            res.top = target.top + target.height + mainOffset;
        } else if(this._checkMainDirection(direction, 'top')) {
            res.top = target.top - popup.height - mainOffset;
        } else if(this._checkMainDirection(direction, 'left')) {
            res.left = target.left - popup.width - mainOffset;
        } else if(this._checkMainDirection(direction, 'right')) {
            res.left = target.left + target.width + mainOffset;
        }

        if(this._checkSecondaryDirection(direction, 'right')) {
            res.left = target.left + target.width - popup.width - secondaryOffset;
        } else if(this._checkSecondaryDirection(direction, 'left')) {
            res.left = target.left + secondaryOffset;
        } else if(this._checkSecondaryDirection(direction, 'bottom')) {
            res.top = target.top + target.height - popup.height - secondaryOffset;
        } else if(this._checkSecondaryDirection(direction, 'top')) {
            res.top = target.top + secondaryOffset;
        } else if(this._checkSecondaryDirection(direction, 'center')) {
            if(this._checkMainDirection(direction, 'top', 'bottom')) {
                res.left = target.left + target.width / 2 - popup.width / 2;
            } else if(this._checkMainDirection(direction, 'left', 'right')) {
                res.top = target.top + target.height / 2 - popup.height / 2;
            }
        }

        return res;
    },

    _calcViewportFactor : function(pos, viewport, popup) {
        var viewportOffset = this.params.viewportOffset,
            intersectionLeft = Math.max(pos.left, viewport.left + viewportOffset),
            intersectionRight = Math.min(pos.left + popup.width, viewport.right - viewportOffset),
            intersectionTop = Math.max(pos.top, viewport.top + viewportOffset),
            intersectionBottom = Math.min(pos.top + popup.height, viewport.bottom - viewportOffset);

        return intersectionLeft < intersectionRight && intersectionTop < intersectionBottom? // has intersection
            (intersectionRight - intersectionLeft) *
                (intersectionBottom - intersectionTop) /
                popup.area :
            0;
    },

    _checkMainDirection : function(direction, mainDirection1, mainDirection2) {
        return !direction.indexOf(mainDirection1) || (mainDirection2 && !direction.indexOf(mainDirection2));
    },

    _checkSecondaryDirection : function(direction, secondaryDirection) {
        return ~direction.indexOf('-' + secondaryDirection);
    },

    _onWinScrollAndResize : function() {
        this.redraw();
    },

    getDefaultParams : function() {
        return objects.extend(
            this.__base.apply(this, arguments),
            {
                mainOffset : 0,
                secondaryOffset : 0,
                viewportOffset : 0,
                directions : DEFAULT_DIRECTIONS
            });
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/popup/_target/popup_target.js */
/* begin: ../../libs/bem-components/common.blocks/popup/_autoclosable/popup_autoclosable.js */
/**
 * @module popup
 */

modules.define(
    'popup',
    ['jquery', 'i-bem__dom', 'ua', 'dom', 'keyboard__codes'],
    function(provide, $, BEMDOM, ua, dom, keyCodes, Popup) {

var KEYDOWN_EVENT = ua.opera && ua.version < 12.10? 'keypress' : 'keydown',
    visiblePopupsStack = [];

/**
 * @exports
 * @class popup
 * @bem
 */
provide(Popup.decl({ modName : 'autoclosable', modVal : true }, /** @lends popup.prototype */{
    onSetMod : {
        'visible' : {
            'true' : function() {
                visiblePopupsStack.unshift(this);
                this
                    // NOTE: nextTick because of event bubbling to document
                    .nextTick(function() {
                        this.bindToDoc('pointerclick', this._onDocPointerClick);
                    })
                    .__base.apply(this, arguments);
            },

            '' : function() {
                visiblePopupsStack.splice(visiblePopupsStack.indexOf(this), 1);
                this
                    .unbindFromDoc('pointerclick', this._onDocPointerClick)
                    .__base.apply(this, arguments);
            }
        }
    },

    _onDocPointerClick : function(e) {
        if(this.hasMod('target', 'anchor') && dom.contains(this._anchor, $(e.target)))
            return;

        this._preventHideByClick?
           this._preventHideByClick = null :
           this.delMod('visible');
    }
}, /** @lends popup */{
    live : function() {
        BEMDOM.doc.on(KEYDOWN_EVENT, onDocKeyPress);
    }
}));

function onDocKeyPress(e) {
    e.keyCode === keyCodes.ESC &&
        // omit ESC in inputs, selects and etc.
        visiblePopupsStack.length &&
        !dom.isEditable($(e.target)) &&
            visiblePopupsStack[0].delMod('visible');
}

});

/* end: ../../libs/bem-components/common.blocks/popup/_autoclosable/popup_autoclosable.js */
/* begin: ../../libs/bem-components/common.blocks/popup/_target/popup_target_anchor.js */
/**
 * @module popup
 */

modules.define(
    'popup',
    ['i-bem__dom', 'jquery', 'objects', 'functions__throttle'],
    function(provide, BEMDOM, $, objects, throttle, Popup) {

var body = $(BEMDOM.doc[0].body),
    UPDATE_TARGET_VISIBILITY_THROTTLING_INTERVAL = 100,
    undef;

/**
 * @exports
 * @class popup
 * @bem
 */
provide(Popup.decl({ modName : 'target', modVal : 'anchor' }, /** @lends popup.prototype */{
    beforeSetMod : {
        'visible' : {
            'true' : function() {
                if(!this._anchor)
                    throw Error('Can\'t show popup without anchor');
            }
        }
    },

    onSetMod : {
        'js' : {
            'inited' : function() {
                this.__base.apply(this, arguments);

                this._anchor = null;
                this._anchorParents = null;
                this._destructor = null;
                this._isAnchorVisible = undef;
                this._updateIsAnchorVisible = throttle(
                    this._updateIsAnchorVisible,
                    UPDATE_TARGET_VISIBILITY_THROTTLING_INTERVAL,
                    false,
                    this);
            },

            '' : function() {
                this.__base.apply(this, arguments);
                this._unbindFromDestructor(); // don't destruct anchor as it might be the same anchor for several popups
            }
        },

        'visible' : {
            'true' : function() {
                this._anchorParents = this._anchor.parents();
                this._bindToAnchorParents();

                this.__base.apply(this, arguments);
            },

            '' : function() {
                this.__base.apply(this, arguments);

                this._unbindFromAnchorParents();
                this._anchorParents = null;
                this._isAnchorVisible = undef;
            }
        }
    },

    /**
     * Sets target
     * @param {jQuery|BEMDOM} anchor DOM elem or anchor BEMDOM block
     * @returns {popup} this
     */
    setAnchor : function(anchor) {
        this
            ._unbindFromAnchorParents()
            ._unbindFromParentPopup()
            ._unbindFromDestructor();

        this._anchor = anchor instanceof BEMDOM?
            anchor.domElem :
            anchor;

        this._destructor = this._anchor.bem('_' + this.__self.getName() + '-destructor');
        this._isAnchorVisible = undef;

        this._bindToDestructor();

        if(this.hasMod('visible')) {
            this._anchorParents = this._anchor.parents();
            this
                ._recaptureZIndex()
                ._bindToAnchorParents()
                ._bindToParentPopup()
                .redraw();
        } else {
            this._anchorParents = null;
            this._zIndexGroupLevel = null;
        }

        return this;
    },

    /**
     * @override
     */
    _calcTargetDimensions : function() {
        var anchor = this._anchor,
            anchorOffset = anchor.offset(),
            bodyOffset = body.css('position') === 'static'?
                { left : 0, top : 0 } :
                body.offset();

        return {
            left : anchorOffset.left - bodyOffset.left,
            top : anchorOffset.top - bodyOffset.top,
            width : anchor.outerWidth(),
            height : anchor.outerHeight()
        };
    },

    /**
     * @override
     */
    _calcDrawingCss : function(drawingParams) {
        typeof this._isAnchorVisible === 'undefined' &&
            (this._isAnchorVisible = this._calcIsAnchorVisible());

        return objects.extend(
            this.__base(drawingParams),
            { display : this._isAnchorVisible? '' : 'none' });
    },

    /**
     * Calculates target visibility state
     * @private
     * @returns {Boolean} Whether state is visible
     */
    _calcIsAnchorVisible : function() {
        var anchor = this._anchor,
            anchorOffset = anchor.offset(),
            anchorLeft = anchorOffset.left,
            anchorTop = anchorOffset.top,
            anchorRight = anchorLeft + anchor.outerWidth(),
            anchorBottom = anchorTop + anchor.outerHeight(),
            direction = this.getMod('direction'),
            vertBorder = Math.floor(this._checkMainDirection(direction, 'top') ||
                    this._checkSecondaryDirection(direction, 'top')?
                anchorTop :
                anchorBottom),
            horizBorder = Math.floor(this._checkMainDirection(direction, 'left') ||
                    this._checkSecondaryDirection(direction, 'left')?
                anchorLeft :
                anchorRight),
            res = true;

        this._anchorParents.each(function() {
            if(this.tagName === 'BODY') return false;

            var parent = $(this),
                overflowY = parent.css('overflow-y'),
                checkOverflowY = overflowY === 'scroll' || overflowY === 'hidden' || overflowY === 'auto',
                overflowX = parent.css('overflow-x'),
                checkOverflowX = overflowX === 'scroll' || overflowX === 'hidden' || overflowX === 'auto';

            if(checkOverflowY || checkOverflowX) {
                var parentOffset = parent.offset();

                if(checkOverflowY) {
                    var parentTopOffset = Math.floor(parentOffset.top);
                    if(vertBorder < parentTopOffset || parentTopOffset + parent.outerHeight() < vertBorder) {
                        return res = false;
                    }
                }

                if(checkOverflowX) {
                    var parentLeftOffset = Math.floor(parentOffset.left);
                    return res = !(
                        horizBorder < parentLeftOffset ||
                        parentLeftOffset + parent.outerWidth() < horizBorder);
                }
            }
        });

        return res;
    },

    _calcZIndexGroupLevel : function() {
        var res = this.__base.apply(this, arguments);

        return this._destructor.findBlocksOutside('z-index-group').reduce(
            function(res, zIndexGroup) {
                return res + Number(zIndexGroup.getMod('level'));
            },
            res);
    },

    _bindToAnchorParents : function() {
        return this.bindTo(
            this._anchorParents,
            'scroll',
            this._onAnchorParentsScroll);
    },

    _unbindFromAnchorParents : function() {
        this._anchorParents && this.unbindFrom(
            this._anchorParents,
            'scroll',
            this._onAnchorParentsScroll);
        return this;
    },

    _onAnchorParentsScroll : function() {
        this
            .redraw()
            ._updateIsAnchorVisible();
    },

    /**
     * @override
     */
    _onWinScrollAndResize : function() {
        this.__base.apply(this, arguments);
        this._updateIsAnchorVisible();
    },

    _updateIsAnchorVisible : function() {
        if(!this.hasMod('js', 'inited') || !this.hasMod('visible'))
            return;

        var isAnchorVisible = this._calcIsAnchorVisible();
        if(isAnchorVisible !== this._isAnchorVisible) {
            this._isAnchorVisible = isAnchorVisible;
            this.redraw();
        }
    },

    _bindToDestructor : function() {
        this._destructor.on({ modName : 'js', modVal : '' }, this._onPopupAnchorDestruct, this);
        return this;
    },

    _unbindFromDestructor : function() {
        this._destructor &&
            this._destructor.un({ modName : 'js', modVal : '' }, this._onPopupAnchorDestruct, this);
        return this;
    },

    _onPopupAnchorDestruct : function() {
        BEMDOM.destruct(this.domElem);
    },

    _getParentPopup : function() {
        return this._parentPopup === undef?
            this._parentPopup = this.findBlockOutside(this._anchor, this.__self.getName()) :
            this._parentPopup;
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/popup/_target/popup_target_anchor.js */
/* begin: ../../libs/bem-core/common.blocks/i-bem/__dom/_init/i-bem__dom_init_auto.js */
/**
 * Auto initialization on DOM ready
 */

modules.require(
    ['i-bem__dom_init', 'jquery', 'next-tick'],
    function(init, $, nextTick) {

$(function() {
    nextTick(init);
});

});

/* end: ../../libs/bem-core/common.blocks/i-bem/__dom/_init/i-bem__dom_init_auto.js */
/* begin: ../../libs/bem-core/common.blocks/loader/_type/loader_type_js.js */
/**
 * @module loader_type_js
 * @description Load JS from external URL.
 */

modules.define('loader_type_js', function(provide) {

var loading = {},
    loaded = {},
    head = document.getElementsByTagName('head')[0],
    runCallbacks = function(path, type) {
        var cbs = loading[path], cb, i = 0;
        delete loading[path];
        while(cb = cbs[i++]) {
            cb[type] && cb[type]();
        }
    },
    onSuccess = function(path) {
        loaded[path] = true;
        runCallbacks(path, 'success');
    },
    onError = function(path) {
        runCallbacks(path, 'error');
    };

provide(
    /**
     * @exports
     * @param {String} path resource link
     * @param {Function} success to be called if the script succeeds
     * @param {Function} error to be called if the script fails
     */
    function(path, success, error) {
        if(loaded[path]) {
            success();
            return;
        }

        if(loading[path]) {
            loading[path].push({ success : success, error : error });
            return;
        }

        loading[path] = [{ success : success, error : error }];

        var script = document.createElement('script');
        script.type = 'text/javascript';
        script.charset = 'utf-8';
        script.src = (location.protocol === 'file:' && !path.indexOf('//')? 'http:' : '') + path;

        if('onload' in script) {
            script.onload = function() {
                script.onload = script.onerror = null;
                onSuccess(path);
            };

            script.onerror = function() {
                script.onload = script.onerror = null;
                onError(path);
            };
        } else {
            script.onreadystatechange = function() {
                var readyState = this.readyState;
                if(readyState === 'loaded' || readyState === 'complete') {
                    script.onreadystatechange = null;
                    onSuccess(path);
                }
            };
        }

        head.insertBefore(script, head.lastChild);
    }
);

});

/* end: ../../libs/bem-core/common.blocks/loader/_type/loader_type_js.js */
/* begin: ../../libs/bem-core/common.blocks/jquery/__event/_type/jquery__event_type_pointerpressrelease.js */
modules.define('jquery', function(provide, $) {

$.each({
    pointerpress : 'pointerdown',
    pointerrelease : 'pointerup pointercancel'
}, function(spec, origEvent) {
    function eventHandler(e) {
        var res, origType = e.handleObj.origType;

        if(e.which === 1) {
            e.type = spec;
            res = $.event.dispatch.apply(this, arguments);
            e.type = origType;
        }

        return res;
    }

    $.event.special[spec] = {
        setup : function() {
            $(this).on(origEvent, eventHandler);
            return false;
        },
        teardown : function() {
            $(this).off(origEvent, eventHandler);
            return false;
        }
    };
});

provide($);

});

/* end: ../../libs/bem-core/common.blocks/jquery/__event/_type/jquery__event_type_pointerpressrelease.js */
/* begin: ../../libs/bem-components/common.blocks/button/_type/button_type_link.js */
/**
 * @module button
 */

modules.define('button', function(provide, Button) {

/**
 * @exports
 * @class button
 * @bem
 */
provide(Button.decl({ modName : 'type', modVal : 'link' }, /** @lends button.prototype */{
    onSetMod : {
        'js' : {
            'inited' : function() {
                this.__base.apply(this, arguments);
                this._url = this.params.url || this.domElem.attr('href');

                this.hasMod('disabled') && this.domElem.removeAttr('href');
            }
        },

        'disabled' : {
            'true' : function() {
                this.__base.apply(this, arguments);
                this.domElem.removeAttr('href');
            },

            '' : function() {
                this.__base.apply(this, arguments);
                this.domElem.attr('href', this._url);
            }
        }
    },

    /**
     * Returns url
     * @returns {String}
     */
    getUrl : function() {
        return this._url;
    },

    /**
     * Sets url
     * @param {String} url
     * @returns {button} this
     */
    setUrl : function(url) {
        this._url = url;
        this.hasMod('disabled') || this.domElem.attr('href', url);
        return this;
    },

    _doAction : function() {
        this._url && (document.location = this._url);
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/button/_type/button_type_link.js */
/* begin: ../../common.blocks/api/__airport-status/_data/api__airport-status_data.js */
window.airportStatusData = {
    "request": {
        "airport": {
            "requestedCode": "SVO",
            "fsCode": "SVO"
        },
        "date": {
            "year": "2015",
            "month": "8",
            "day": "6",
            "interpreted": "2015-08-06"
        },
        "hourOfDay": {
            "requested": "8",
            "interpreted": 8
        },
        "numHours": {
            "requested": "5",
            "interpreted": 5
        },
        "utc": {
            "interpreted": false
        },
        "codeType": {},
        "maxFlights": {
            "requested": "500",
            "interpreted": 500
        },
        "extendedOptions": {},
        "url": "https://api.flightstats.com/flex/flightstatus/rest/v2/jsonp/airport/status/SVO/dep/2015/8/6/8"
    },
    "appendix": {
        "airlines": [
            {
                "fs": "KL",
                "iata": "KL",
                "icao": "KLM",
                "name": "KLM",
                "active": true
            },
            {
                "fs": "SU",
                "iata": "SU",
                "icao": "AFL",
                "name": "Aeroflot",
                "active": true
            },
            {
                "fs": "JL",
                "iata": "JL",
                "icao": "JAL",
                "name": "JAL",
                "active": true
            },
            {
                "fs": "UX",
                "iata": "UX",
                "icao": "AEA",
                "name": "Air Europa",
                "active": true
            },
            {
                "fs": "FI",
                "iata": "FI",
                "icao": "ICE",
                "name": "Icelandair",
                "active": true
            },
            {
                "fs": "RU",
                "iata": "RU",
                "icao": "ABW",
                "name": "AirBridgeCargo",
                "active": true
            },
            {
                "fs": "LO",
                "iata": "LO",
                "icao": "LOT",
                "name": "LOT - Polish Airlines",
                "active": true
            },
            {
                "fs": "AF",
                "iata": "AF",
                "icao": "AFR",
                "name": "Air France",
                "phoneNumber": "1-800-237-2747",
                "active": true
            },
            {
                "fs": "MU",
                "iata": "MU",
                "icao": "CES",
                "name": "China Eastern Airlines",
                "active": true
            },
            {
                "fs": "DL",
                "iata": "DL",
                "icao": "DAL",
                "name": "Delta Air Lines",
                "phoneNumber": "1-800-221-1212",
                "active": true
            },
            {
                "fs": "JU",
                "iata": "JU",
                "icao": "JAT",
                "name": "Air Serbia",
                "active": true
            },
            {
                "fs": "BT",
                "iata": "BT",
                "icao": "BTI",
                "name": "Air Baltic",
                "active": true
            },
            {
                "fs": "D9",
                "iata": "D9",
                "icao": "DNV",
                "name": "Donavia",
                "active": true
            },
            {
                "fs": "KC",
                "iata": "KC",
                "icao": "KZR",
                "name": "Air Astana",
                "active": true
            },
            {
                "fs": "AY",
                "iata": "AY",
                "icao": "FIN",
                "name": "Finnair",
                "active": true
            },
            {
                "fs": "5N",
                "iata": "5N",
                "icao": "AUL",
                "name": "Nordavia Regional Airlines",
                "active": true
            },
            {
                "fs": "AZ",
                "iata": "AZ",
                "icao": "AZA",
                "name": "Alitalia",
                "active": true
            },
            {
                "fs": "KE",
                "iata": "KE",
                "icao": "KAL",
                "name": "Korean Air",
                "active": true
            },
            {
                "fs": "OK",
                "iata": "OK",
                "icao": "CSA",
                "name": "CSA",
                "active": true
            },
            {
                "fs": "FB",
                "iata": "FB",
                "icao": "LZB",
                "name": "Bulgaria Air",
                "active": true
            },
            {
                "fs": "RO",
                "iata": "RO",
                "icao": "ROT",
                "name": "TAROM",
                "active": true
            }
        ],
        "airports": [
            {
                "fs": "PVG",
                "iata": "PVG",
                "icao": "ZSPD",
                "name": "Shanghai Pudong International Airport",
                "street1": "No.300 Qihang Road",
                "city": "Shanghai",
                "cityCode": "SHA",
                "countryCode": "CN",
                "countryName": "China",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Shanghai",
                "localTime": "2015-08-06T13:52:27.398",
                "utcOffsetHours": 8,
                "latitude": 31.151824,
                "longitude": 121.799808,
                "elevationFeet": 13,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/PVG?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/PVG?codeType=fs"
            },
            {
                "fs": "RIX",
                "iata": "RIX",
                "icao": "EVRA",
                "name": "Riga International Airport",
                "city": "Riga",
                "cityCode": "RIX",
                "countryCode": "LV",
                "countryName": "Latvia",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Riga",
                "localTime": "2015-08-06T08:52:27.399",
                "utcOffsetHours": 3,
                "latitude": 56.92208,
                "longitude": 23.979806,
                "elevationFeet": 34,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/RIX?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/RIX?codeType=fs"
            },
            {
                "fs": "SXF",
                "iata": "SXF",
                "icao": "EDDB",
                "name": "Schonefeld Airport",
                "city": "Berlin",
                "cityCode": "BER",
                "countryCode": "DE",
                "countryName": "Germany",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Berlin",
                "localTime": "2015-08-06T07:52:27.401",
                "utcOffsetHours": 2,
                "latitude": 52.370278,
                "longitude": 13.521388,
                "elevationFeet": 154,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/SXF?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/SXF?codeType=fs"
            },
            {
                "fs": "ZAG",
                "iata": "ZAG",
                "icao": "LDZA",
                "name": "Zagreb International Airport",
                "city": "Zagreb",
                "cityCode": "ZAG",
                "countryCode": "HR",
                "countryName": "Croatia",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Zagreb",
                "localTime": "2015-08-06T07:52:27.406",
                "utcOffsetHours": 2,
                "latitude": 45.733242,
                "longitude": 16.061519,
                "elevationFeet": 353,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/ZAG?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/ZAG?codeType=fs"
            },
            {
                "fs": "LAX",
                "iata": "LAX",
                "icao": "KLAX",
                "faa": "LAX",
                "name": "Los Angeles International Airport",
                "street1": "One World Way",
                "street2": "",
                "city": "Los Angeles",
                "cityCode": "LAX",
                "stateCode": "CA",
                "postalCode": "90045-5803",
                "countryCode": "US",
                "countryName": "United States",
                "regionName": "North America",
                "timeZoneRegionName": "America/Los_Angeles",
                "weatherZone": "CAZ041",
                "localTime": "2015-08-05T22:52:27.382",
                "utcOffsetHours": -7,
                "latitude": 33.943399,
                "longitude": -118.408279,
                "elevationFeet": 126,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/LAX?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/LAX?codeType=fs"
            },
            {
                "fs": "BRU",
                "iata": "BRU",
                "icao": "EBBR",
                "name": "Brussels Airport",
                "city": "Brussels",
                "cityCode": "BRU",
                "countryCode": "BE",
                "countryName": "Belgium",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Brussels",
                "localTime": "2015-08-06T07:52:27.370",
                "utcOffsetHours": 2,
                "latitude": 50.89717,
                "longitude": 4.483602,
                "elevationFeet": 184,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/BRU?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/BRU?codeType=fs"
            },
            {
                "fs": "MXP",
                "iata": "MXP",
                "icao": "LIMC",
                "name": "Milano Malpensa Airport",
                "city": "Milan",
                "cityCode": "MIL",
                "countryCode": "IT",
                "countryName": "Italy",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Rome",
                "localTime": "2015-08-06T07:52:27.390",
                "utcOffsetHours": 2,
                "latitude": 45.627405,
                "longitude": 8.71237,
                "elevationFeet": 733,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/MXP?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/MXP?codeType=fs"
            },
            {
                "fs": "PRG",
                "iata": "PRG",
                "icao": "LKPR",
                "name": "Vaclav Havel Airport Prague",
                "city": "Prague",
                "cityCode": "PRG",
                "countryCode": "CZ",
                "countryName": "Czech Republic",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Prague",
                "localTime": "2015-08-06T07:52:27.397",
                "utcOffsetHours": 2,
                "latitude": 50.106188,
                "longitude": 14.266638,
                "elevationFeet": 1170,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/PRG?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/PRG?codeType=fs"
            },
            {
                "fs": "CTU",
                "iata": "CTU",
                "icao": "ZUUU",
                "name": "Chengdu Shuangliu International Airport",
                "street1": "Airport Expressway Entrance",
                "city": "Chengdu",
                "cityCode": "CTU",
                "countryCode": "CN",
                "countryName": "China",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Shanghai",
                "localTime": "2015-08-06T13:52:27.371",
                "utcOffsetHours": 8,
                "latitude": 30.581134,
                "longitude": 103.956799,
                "elevationFeet": 1624,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/CTU?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/CTU?codeType=fs"
            },
            {
                "fs": "NJC",
                "iata": "NJC",
                "icao": "USNN",
                "name": "Nizhnevartovsk Airport",
                "city": "Nizhnevartovsk",
                "cityCode": "NJC",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Yekaterinburg",
                "localTime": "2015-08-06T10:52:27.391",
                "utcOffsetHours": 5,
                "latitude": 60.947603,
                "longitude": 76.491447,
                "elevationFeet": 157,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/NJC?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/NJC?codeType=fs"
            },
            {
                "fs": "CDG",
                "iata": "CDG",
                "icao": "LFPG",
                "name": "Charles de Gaulle Airport",
                "street1": "95711, Roissy Charles de Gaulle",
                "city": "Paris",
                "cityCode": "PAR",
                "countryCode": "FR",
                "countryName": "France",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Paris",
                "localTime": "2015-08-06T07:52:27.370",
                "utcOffsetHours": 2,
                "latitude": 49.003196,
                "longitude": 2.567023,
                "elevationFeet": 387,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/CDG?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/CDG?codeType=fs"
            },
            {
                "fs": "FRU",
                "iata": "FRU",
                "icao": "UAFM",
                "name": "Manas International Airport",
                "city": "Bishkek",
                "cityCode": "FRU",
                "countryCode": "KG",
                "countryName": "Kyrgyzstan",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Bishkek",
                "localTime": "2015-08-06T11:52:27.374",
                "utcOffsetHours": 6,
                "latitude": 43.053581,
                "longitude": 74.469449,
                "elevationFeet": 2090,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/FRU?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/FRU?codeType=fs"
            },
            {
                "fs": "OTP",
                "iata": "OTP",
                "icao": "LROP",
                "name": "Otopeni International Airport",
                "city": "Bucharest",
                "cityCode": "BUH",
                "countryCode": "RO",
                "countryName": "Romania",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Bucharest",
                "localTime": "2015-08-06T08:52:27.391",
                "utcOffsetHours": 3,
                "latitude": 44.571155,
                "longitude": 26.077063,
                "elevationFeet": 314,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/OTP?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/OTP?codeType=fs"
            },
            {
                "fs": "JFK",
                "iata": "JFK",
                "icao": "KJFK",
                "faa": "JFK",
                "name": "John F. Kennedy International Airport",
                "street1": "JFK Airport",
                "city": "New York",
                "cityCode": "NYC",
                "stateCode": "NY",
                "postalCode": "11430",
                "countryCode": "US",
                "countryName": "United States",
                "regionName": "North America",
                "timeZoneRegionName": "America/New_York",
                "weatherZone": "NYZ178",
                "localTime": "2015-08-06T01:52:27.378",
                "utcOffsetHours": -4,
                "latitude": 40.642335,
                "longitude": -73.78817,
                "elevationFeet": 13,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/JFK?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/JFK?codeType=fs"
            },
            {
                "fs": "STR",
                "iata": "STR",
                "icao": "EDDS",
                "name": "Stuttgart Airport",
                "city": "Stuttgart",
                "cityCode": "STR",
                "countryCode": "DE",
                "countryName": "Germany",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Berlin",
                "localTime": "2015-08-06T07:52:27.400",
                "utcOffsetHours": 2,
                "latitude": 48.690732,
                "longitude": 9.193624,
                "elevationFeet": 1250,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/STR?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/STR?codeType=fs"
            },
            {
                "fs": "ZRH",
                "iata": "ZRH",
                "icao": "LSZH",
                "name": "Zurich Airport",
                "city": "Zurich",
                "cityCode": "ZRH",
                "countryCode": "CH",
                "countryName": "Switzerland",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Zurich",
                "localTime": "2015-08-06T07:52:27.406",
                "utcOffsetHours": 2,
                "latitude": 47.450604,
                "longitude": 8.561746,
                "elevationFeet": 1416,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/ZRH?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/ZRH?codeType=fs"
            },
            {
                "fs": "GYD",
                "iata": "GYD",
                "name": "Heydar Aliyev International Airport",
                "city": "Baku",
                "cityCode": "BAK",
                "countryCode": "AZ",
                "countryName": "Azerbaijan",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Baku",
                "localTime": "2015-08-06T10:52:27.375",
                "utcOffsetHours": 5,
                "latitude": 40.462487,
                "longitude": 50.05039,
                "elevationFeet": 2,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/GYD?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/GYD?codeType=fs"
            },
            {
                "fs": "TJM",
                "iata": "TJM",
                "icao": "USTR",
                "name": "Roshchino International Airport",
                "city": "Tyumen",
                "cityCode": "TJM",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Yekaterinburg",
                "localTime": "2015-08-06T10:52:27.401",
                "utcOffsetHours": 5,
                "latitude": 57.181826,
                "longitude": 65.350246,
                "elevationFeet": 371,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/TJM?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/TJM?codeType=fs"
            },
            {
                "fs": "VNO",
                "iata": "VNO",
                "icao": "EYVI",
                "name": "Vilnius International Airport",
                "city": "Vilnius",
                "cityCode": "VNO",
                "countryCode": "LT",
                "countryName": "Lithuania",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Vilnius",
                "localTime": "2015-08-06T08:52:27.404",
                "utcOffsetHours": 3,
                "latitude": 54.643079,
                "longitude": 25.279605,
                "elevationFeet": 646,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/VNO?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/VNO?codeType=fs"
            },
            {
                "fs": "MUC",
                "iata": "MUC",
                "icao": "EDDM",
                "name": "Franz Josef Strauss Airport",
                "city": "Munich",
                "cityCode": "MUC",
                "countryCode": "DE",
                "countryName": "Germany",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Berlin",
                "localTime": "2015-08-06T07:52:27.390",
                "utcOffsetHours": 2,
                "latitude": 48.353005,
                "longitude": 11.790143,
                "elevationFeet": 1486,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/MUC?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/MUC?codeType=fs"
            },
            {
                "fs": "AYT",
                "iata": "AYT",
                "icao": "LTAI",
                "name": "Antalya Airport",
                "city": "Antalya",
                "cityCode": "AYT",
                "countryCode": "TR",
                "countryName": "Turkey",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Istanbul",
                "localTime": "2015-08-06T08:52:27.368",
                "utcOffsetHours": 3,
                "latitude": 36.899282,
                "longitude": 30.801349,
                "elevationFeet": 177,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/AYT?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/AYT?codeType=fs"
            },
            {
                "fs": "GDZ",
                "iata": "GDZ",
                "name": "Gelendzik Airport",
                "city": "Gelendzik",
                "cityCode": "GDZ",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.374",
                "utcOffsetHours": 3,
                "latitude": 44.566667,
                "longitude": 38.016667,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/GDZ?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/GDZ?codeType=fs"
            },
            {
                "fs": "KUF",
                "iata": "KUF",
                "icao": "UWWW",
                "name": "Kurumoch International Airport",
                "city": "Samara",
                "cityCode": "KUF",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Samara",
                "localTime": "2015-08-06T09:52:27.381",
                "utcOffsetHours": 4,
                "latitude": 53.507819,
                "longitude": 50.14742,
                "elevationFeet": 476,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/KUF?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/KUF?codeType=fs"
            },
            {
                "fs": "HKG",
                "iata": "HKG",
                "icao": "VHHH",
                "name": "Hong Kong International Airport",
                "street1": "1 Cheong Hong Rd",
                "street2": "Chek Lap Kok Airport",
                "city": "Hong Kong",
                "cityCode": "HKG",
                "countryCode": "HK",
                "countryName": "Hong Kong",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Hong_Kong",
                "localTime": "2015-08-06T13:52:27.376",
                "utcOffsetHours": 8,
                "latitude": 22.315248,
                "longitude": 113.93649,
                "elevationFeet": 19,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/HKG?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/HKG?codeType=fs"
            },
            {
                "fs": "AMS",
                "iata": "AMS",
                "icao": "EHAM",
                "name": "Amsterdam Airport Schiphol",
                "city": "Amsterdam",
                "cityCode": "AMS",
                "countryCode": "NL",
                "countryName": "Netherlands",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Amsterdam",
                "localTime": "2015-08-06T07:52:27.368",
                "utcOffsetHours": 2,
                "latitude": 52.309069,
                "longitude": 4.763385,
                "elevationFeet": -11,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/AMS?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/AMS?codeType=fs"
            },
            {
                "fs": "TOF",
                "iata": "TOF",
                "name": "Tomsk Airport",
                "city": "Tomsk",
                "cityCode": "TOF",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Novosibirsk",
                "localTime": "2015-08-06T11:52:27.402",
                "utcOffsetHours": 6,
                "latitude": 56.5,
                "longitude": 84.966667,
                "elevationFeet": 597,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/TOF?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/TOF?codeType=fs"
            },
            {
                "fs": "LCA",
                "iata": "LCA",
                "icao": "LCLK",
                "name": "Larnaca International Airport",
                "city": "Larnaca",
                "cityCode": "LCA",
                "countryCode": "CY",
                "countryName": "Cyprus",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Nicosia",
                "localTime": "2015-08-06T08:52:27.383",
                "utcOffsetHours": 3,
                "latitude": 34.870871,
                "longitude": 33.607975,
                "elevationFeet": 8,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/LCA?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/LCA?codeType=fs"
            },
            {
                "fs": "BCN",
                "iata": "BCN",
                "icao": "LEBL",
                "name": "Barcelona-El Prat Airport",
                "city": "Barcelona",
                "cityCode": "BCN",
                "stateCode": "SP",
                "countryCode": "ES",
                "countryName": "Spain and Canary Islands",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Madrid",
                "localTime": "2015-08-06T07:52:27.369",
                "utcOffsetHours": 2,
                "latitude": 41.303027,
                "longitude": 2.07593,
                "elevationFeet": 13,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/BCN?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/BCN?codeType=fs"
            },
            {
                "fs": "IAD",
                "iata": "IAD",
                "icao": "KIAD",
                "faa": "IAD",
                "name": "Washington Dulles International Airport",
                "street1": "1 Aviation Circle",
                "city": "Washington",
                "cityCode": "WAS",
                "stateCode": "DC",
                "postalCode": "20001-6000",
                "countryCode": "US",
                "countryName": "United States",
                "regionName": "North America",
                "timeZoneRegionName": "America/New_York",
                "weatherZone": "DCZ001",
                "localTime": "2015-08-06T01:52:27.377",
                "utcOffsetHours": -4,
                "latitude": 38.95315,
                "longitude": -77.447735,
                "elevationFeet": 313,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/IAD?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/IAD?codeType=fs"
            },
            {
                "fs": "AER",
                "iata": "AER",
                "icao": "URSS",
                "name": "Sochi International Airport",
                "city": "Adler/Sochi",
                "cityCode": "AER",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.367",
                "utcOffsetHours": 3,
                "latitude": 43.44884,
                "longitude": 39.941106,
                "elevationFeet": 89,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/AER?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/AER?codeType=fs"
            },
            {
                "fs": "VOG",
                "iata": "VOG",
                "icao": "URWW",
                "name": "Volgograd International Airport",
                "city": "Volgograd",
                "cityCode": "VOG",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.404",
                "utcOffsetHours": 3,
                "latitude": 48.792,
                "longitude": 44.354805,
                "elevationFeet": 482,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/VOG?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/VOG?codeType=fs"
            },
            {
                "fs": "AAQ",
                "iata": "AAQ",
                "icao": "URKA",
                "name": "Anapa Airport",
                "city": "Anapa",
                "cityCode": "AAQ",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.366",
                "utcOffsetHours": 3,
                "latitude": 45.001659,
                "longitude": 37.346599,
                "elevationFeet": 141,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/AAQ?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/AAQ?codeType=fs"
            },
            {
                "fs": "NCE",
                "iata": "NCE",
                "icao": "LFMN",
                "name": "Cote D'Azur Airport",
                "city": "Nice",
                "cityCode": "NCE",
                "countryCode": "FR",
                "countryName": "France",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Paris",
                "localTime": "2015-08-06T07:52:27.390",
                "utcOffsetHours": 2,
                "latitude": 43.660488,
                "longitude": 7.205232,
                "elevationFeet": 13,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/NCE?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/NCE?codeType=fs"
            },
            {
                "fs": "FCO",
                "iata": "FCO",
                "icao": "LIRF",
                "name": "Leonardo da Vinci-Fiumicino Airport",
                "city": "Rome",
                "cityCode": "ROM",
                "countryCode": "IT",
                "countryName": "Italy",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Rome",
                "localTime": "2015-08-06T07:52:27.372",
                "utcOffsetHours": 2,
                "latitude": 41.794594,
                "longitude": 12.250346,
                "elevationFeet": 14,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/FCO?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/FCO?codeType=fs"
            },
            {
                "fs": "GVA",
                "iata": "GVA",
                "icao": "LSGG",
                "name": "Geneve-Cointrin Airport",
                "city": "Geneva",
                "cityCode": "GVA",
                "countryCode": "CH",
                "countryName": "Switzerland",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Zurich",
                "localTime": "2015-08-06T07:52:27.375",
                "utcOffsetHours": 2,
                "latitude": 46.229634,
                "longitude": 6.105774,
                "elevationFeet": 1411,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/GVA?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/GVA?codeType=fs"
            },
            {
                "fs": "ARH",
                "iata": "ARH",
                "icao": "ULAA",
                "name": "Talagi Airport",
                "city": "Arkhangelsk",
                "cityCode": "ARH",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.368",
                "utcOffsetHours": 3,
                "latitude": 64.597581,
                "longitude": 40.713989,
                "elevationFeet": 33,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/ARH?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/ARH?codeType=fs"
            },
            {
                "fs": "ROV",
                "iata": "ROV",
                "icao": "URRR",
                "name": "Rostov Airport",
                "city": "Rostov",
                "cityCode": "ROV",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.399",
                "utcOffsetHours": 3,
                "latitude": 47.253513,
                "longitude": 39.804021,
                "elevationFeet": 279,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/ROV?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/ROV?codeType=fs"
            },
            {
                "fs": "VCE",
                "iata": "VCE",
                "icao": "LIPZ",
                "name": "Venice Marco Polo Airport",
                "city": "Venice",
                "cityCode": "VCE",
                "countryCode": "IT",
                "countryName": "Italy",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Rome",
                "localTime": "2015-08-06T07:52:27.404",
                "utcOffsetHours": 2,
                "latitude": 45.502285,
                "longitude": 12.337947,
                "elevationFeet": 7,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/VCE?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/VCE?codeType=fs"
            },
            {
                "fs": "OVB",
                "iata": "OVB",
                "icao": "UNNT",
                "name": "Novosibirsk Tolmachevo Airport",
                "city": "Novosibirsk",
                "cityCode": "OVB",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Novosibirsk",
                "localTime": "2015-08-06T11:52:27.392",
                "utcOffsetHours": 6,
                "latitude": 55.009011,
                "longitude": 82.666999,
                "elevationFeet": 365,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/OVB?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/OVB?codeType=fs"
            },
            {
                "fs": "SIP",
                "iata": "SIP",
                "icao": "UKFF",
                "name": "Simferopol International Airport",
                "city": "Simferopol",
                "cityCode": "SIP",
                "countryCode": "UA",
                "countryName": "Ukraine",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Kiev",
                "localTime": "2015-08-06T08:52:27.399",
                "utcOffsetHours": 3,
                "latitude": 45.020658,
                "longitude": 33.998193,
                "elevationFeet": 637,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/SIP?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/SIP?codeType=fs"
            },
            {
                "fs": "EVN",
                "iata": "EVN",
                "icao": "UDYZ",
                "name": "Zvartnots International Airport",
                "city": "Yerevan",
                "cityCode": "EVN",
                "countryCode": "AM",
                "countryName": "Armenia",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Yerevan",
                "localTime": "2015-08-06T09:52:27.372",
                "utcOffsetHours": 4,
                "latitude": 40.15272,
                "longitude": 44.39805,
                "elevationFeet": 2838,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/EVN?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/EVN?codeType=fs"
            },
            {
                "fs": "ARN",
                "iata": "ARN",
                "icao": "ESSA",
                "name": "Stockholm Arlanda Airport",
                "city": "Stockholm",
                "cityCode": "STO",
                "countryCode": "SE",
                "countryName": "Sweden",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Stockholm",
                "localTime": "2015-08-06T07:52:27.368",
                "utcOffsetHours": 2,
                "latitude": 59.649818,
                "longitude": 17.930364,
                "elevationFeet": 123,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/ARN?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/ARN?codeType=fs"
            },
            {
                "fs": "KZN",
                "iata": "KZN",
                "icao": "UWKD",
                "name": "Kazan International Airport",
                "city": "Kazan",
                "cityCode": "KZN",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.382",
                "utcOffsetHours": 3,
                "latitude": 55.608439,
                "longitude": 49.29824,
                "elevationFeet": 407,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/KZN?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/KZN?codeType=fs"
            },
            {
                "fs": "VOZ",
                "iata": "VOZ",
                "icao": "UUOO",
                "name": "Voronezh Airport",
                "city": "Voronezh",
                "cityCode": "VOZ",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.405",
                "utcOffsetHours": 3,
                "latitude": 51.812356,
                "longitude": 39.226997,
                "elevationFeet": 514,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/VOZ?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/VOZ?codeType=fs"
            },
            {
                "fs": "BLQ",
                "iata": "BLQ",
                "icao": "LIPE",
                "name": "Guglielmo Marconi Airport",
                "city": "Bologna",
                "cityCode": "BLQ",
                "countryCode": "IT",
                "countryName": "Italy",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Rome",
                "localTime": "2015-08-06T07:52:27.370",
                "utcOffsetHours": 2,
                "latitude": 44.529268,
                "longitude": 11.293289,
                "elevationFeet": 125,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/BLQ?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/BLQ?codeType=fs"
            },
            {
                "fs": "KRR",
                "iata": "KRR",
                "icao": "URKK",
                "name": "Krasnodar International Airport",
                "city": "Krasnodar",
                "cityCode": "KRR",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.380",
                "utcOffsetHours": 3,
                "latitude": 45.034138,
                "longitude": 39.139002,
                "elevationFeet": 118,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/KRR?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/KRR?codeType=fs"
            },
            {
                "fs": "WAW",
                "iata": "WAW",
                "icao": "EPWA",
                "name": "Frederic Chopin Airport",
                "city": "Warsaw",
                "cityCode": "WAW",
                "countryCode": "PL",
                "countryName": "Poland",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Warsaw",
                "localTime": "2015-08-06T07:52:27.405",
                "utcOffsetHours": 2,
                "latitude": 52.170906,
                "longitude": 20.973289,
                "elevationFeet": 361,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/WAW?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/WAW?codeType=fs"
            },
            {
                "fs": "SVO",
                "iata": "SVO",
                "icao": "UUEE",
                "name": "Sheremetyevo International Airport",
                "city": "Moscow",
                "cityCode": "MOW",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.351",
                "utcOffsetHours": 3,
                "latitude": 55.966324,
                "longitude": 37.416574,
                "elevationFeet": 630,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/SVO?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/SVO?codeType=fs"
            },
            {
                "fs": "BUD",
                "iata": "BUD",
                "icao": "LHBP",
                "name": "Budapest Ferenc Liszt International Airport",
                "city": "Budapest",
                "cityCode": "BUD",
                "countryCode": "HU",
                "countryName": "Hungary",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Budapest",
                "localTime": "2015-08-06T07:52:27.370",
                "utcOffsetHours": 2,
                "latitude": 47.433037,
                "longitude": 19.261621,
                "elevationFeet": 495,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/BUD?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/BUD?codeType=fs"
            },
            {
                "fs": "MRV",
                "iata": "MRV",
                "icao": "URMM",
                "name": "Mineralnye Vody Airport",
                "city": "Mineralnye Vody",
                "cityCode": "MRV",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.389",
                "utcOffsetHours": 3,
                "latitude": 44.218354,
                "longitude": 43.088178,
                "elevationFeet": 1080,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/MRV?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/MRV?codeType=fs"
            },
            {
                "fs": "UFA",
                "iata": "UFA",
                "icao": "UWUU",
                "name": "Ufa International Airport",
                "city": "Ufa",
                "cityCode": "UFA",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Yekaterinburg",
                "localTime": "2015-08-06T10:52:27.403",
                "utcOffsetHours": 5,
                "latitude": 54.565403,
                "longitude": 55.884543,
                "elevationFeet": 450,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/UFA?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/UFA?codeType=fs"
            },
            {
                "fs": "SVX",
                "iata": "SVX",
                "icao": "USSS",
                "name": "Koltsovo International Airport",
                "city": "Yekaterinburg",
                "cityCode": "SVX",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Yekaterinburg",
                "localTime": "2015-08-06T10:52:27.400",
                "utcOffsetHours": 5,
                "latitude": 56.750335,
                "longitude": 60.804312,
                "elevationFeet": 764,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/SVX?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/SVX?codeType=fs"
            },
            {
                "fs": "TLL",
                "iata": "TLL",
                "icao": "EETN",
                "name": "Tallinn Airport",
                "city": "Tallinn",
                "cityCode": "TLL",
                "countryCode": "EE",
                "countryName": "Estonia",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Tallinn",
                "localTime": "2015-08-06T08:52:27.401",
                "utcOffsetHours": 3,
                "latitude": 59.416622,
                "longitude": 24.798703,
                "elevationFeet": 132,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/TLL?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/TLL?codeType=fs"
            },
            {
                "fs": "LHR",
                "iata": "LHR",
                "icao": "EGLL",
                "name": "London Heathrow Airport",
                "city": "London",
                "cityCode": "LON",
                "stateCode": "EN",
                "countryCode": "GB",
                "countryName": "United Kingdom",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/London",
                "localTime": "2015-08-06T06:52:27.389",
                "utcOffsetHours": 1,
                "latitude": 51.469603,
                "longitude": -0.453566,
                "elevationFeet": 80,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/LHR?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/LHR?codeType=fs"
            },
            {
                "fs": "KBP",
                "iata": "KBP",
                "icao": "UKBB",
                "name": "Boryspil International Airport",
                "city": "Kiev/Kyiv",
                "cityCode": "IEV",
                "countryCode": "UA",
                "countryName": "Ukraine",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Kiev",
                "localTime": "2015-08-06T08:52:27.379",
                "utcOffsetHours": 3,
                "latitude": 50.341244,
                "longitude": 30.895207,
                "elevationFeet": 427,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/KBP?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/KBP?codeType=fs"
            },
            {
                "fs": "TLV",
                "iata": "TLV",
                "icao": "LLBG",
                "name": "Ben Gurion International Airport",
                "city": "Tel Aviv-Yafo",
                "cityCode": "TLV",
                "countryCode": "IL",
                "countryName": "Israel",
                "regionName": "Middle East",
                "timeZoneRegionName": "Asia/Jerusalem",
                "localTime": "2015-08-06T08:52:27.402",
                "utcOffsetHours": 3,
                "latitude": 32.000454,
                "longitude": 34.870741,
                "elevationFeet": 135,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/TLV?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/TLV?codeType=fs"
            },
            {
                "fs": "DUS",
                "iata": "DUS",
                "icao": "EDDL",
                "name": "Dusseldorf International Airport",
                "city": "Dusseldorf",
                "cityCode": "DUS",
                "countryCode": "DE",
                "countryName": "Germany",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Berlin",
                "localTime": "2015-08-06T07:52:27.372",
                "utcOffsetHours": 2,
                "latitude": 51.278327,
                "longitude": 6.76558,
                "elevationFeet": 147,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/DUS?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/DUS?codeType=fs"
            },
            {
                "fs": "GOJ",
                "iata": "GOJ",
                "icao": "UWGG",
                "name": "Nizhny Novgorod International Airport",
                "city": "Nizhniy Novgorod",
                "cityCode": "GOJ",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.374",
                "utcOffsetHours": 3,
                "latitude": 56.218611,
                "longitude": 43.789766,
                "elevationFeet": 256,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/GOJ?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/GOJ?codeType=fs"
            },
            {
                "fs": "BEG",
                "iata": "BEG",
                "icao": "LYBE",
                "name": "Belgrad Nikola Tesla Airport",
                "city": "Belgrade",
                "cityCode": "BEG",
                "countryCode": "RS",
                "countryName": "Republic of Serbia",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Belgrade",
                "localTime": "2015-08-06T07:52:27.369",
                "utcOffsetHours": 2,
                "latitude": 44.819444,
                "longitude": 20.306944,
                "elevationFeet": 335,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/BEG?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/BEG?codeType=fs"
            },
            {
                "fs": "KGD",
                "iata": "KGD",
                "icao": "UMKK",
                "name": "Khrabrovo Airport",
                "city": "Kaliningrad",
                "cityCode": "KGD",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Kaliningrad",
                "localTime": "2015-08-06T07:52:27.379",
                "utcOffsetHours": 2,
                "latitude": 54.882656,
                "longitude": 20.586646,
                "elevationFeet": 43,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/KGD?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/KGD?codeType=fs"
            },
            {
                "fs": "OSL",
                "iata": "OSL",
                "icao": "ENGM",
                "name": "Oslo Airport Gardermoen",
                "city": "Oslo",
                "cityCode": "OSL",
                "countryCode": "NO",
                "countryName": "Norway",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Oslo",
                "localTime": "2015-08-06T07:52:27.391",
                "utcOffsetHours": 2,
                "latitude": 60.194192,
                "longitude": 11.100411,
                "elevationFeet": 681,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/OSL?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/OSL?codeType=fs"
            },
            {
                "fs": "AGP",
                "iata": "AGP",
                "icao": "LEMG",
                "name": "Malaga Airport",
                "city": "Malaga",
                "cityCode": "AGP",
                "stateCode": "SP",
                "countryCode": "ES",
                "countryName": "Spain and Canary Islands",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Madrid",
                "localTime": "2015-08-06T07:52:27.367",
                "utcOffsetHours": 2,
                "latitude": 36.675181,
                "longitude": -4.489616,
                "elevationFeet": 52,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/AGP?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/AGP?codeType=fs"
            },
            {
                "fs": "LED",
                "iata": "LED",
                "icao": "ULLI",
                "name": "Pulkovo Airport",
                "city": "Saint Petersburg",
                "cityCode": "LED",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Moscow",
                "localTime": "2015-08-06T08:52:27.383",
                "utcOffsetHours": 3,
                "latitude": 59.799847,
                "longitude": 30.270505,
                "elevationFeet": 76,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/LED?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/LED?codeType=fs"
            },
            {
                "fs": "MSQ",
                "iata": "MSQ",
                "icao": "UMMS",
                "name": "Minsk National Airport",
                "city": "Minsk",
                "cityCode": "MSQ",
                "countryCode": "BY",
                "countryName": "Belarus",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Minsk",
                "localTime": "2015-08-06T08:52:27.389",
                "utcOffsetHours": 3,
                "latitude": 53.889725,
                "longitude": 28.032442,
                "elevationFeet": 669,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/MSQ?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/MSQ?codeType=fs"
            },
            {
                "fs": "IST",
                "iata": "IST",
                "icao": "LTBA",
                "name": "Istanbul Ataturk Airport",
                "city": "Istanbul",
                "cityCode": "IST",
                "countryCode": "TR",
                "countryName": "Turkey",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Istanbul",
                "localTime": "2015-08-06T08:52:27.377",
                "utcOffsetHours": 3,
                "latitude": 40.976667,
                "longitude": 28.815278,
                "elevationFeet": 158,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/IST?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/IST?codeType=fs"
            },
            {
                "fs": "SOF",
                "iata": "SOF",
                "icao": "LBSF",
                "name": "Sofia Airport",
                "city": "Sofia",
                "cityCode": "SOF",
                "countryCode": "BG",
                "countryName": "Bulgaria",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Sofia",
                "localTime": "2015-08-06T08:52:27.400",
                "utcOffsetHours": 3,
                "latitude": 42.688342,
                "longitude": 23.414431,
                "elevationFeet": 1742,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/SOF?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/SOF?codeType=fs"
            },
            {
                "fs": "HEL",
                "iata": "HEL",
                "icao": "EFHK",
                "name": "Helsinki-Vantaa Airport",
                "city": "Helsinki",
                "cityCode": "HEL",
                "countryCode": "FI",
                "countryName": "Finland",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Helsinki",
                "localTime": "2015-08-06T08:52:27.376",
                "utcOffsetHours": 3,
                "latitude": 60.317953,
                "longitude": 24.966449,
                "elevationFeet": 167,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/HEL?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/HEL?codeType=fs"
            },
            {
                "fs": "HAJ",
                "iata": "HAJ",
                "icao": "EDDV",
                "name": "Hanover Airport",
                "city": "Hanover",
                "cityCode": "HAJ",
                "countryCode": "DE",
                "countryName": "Germany",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Berlin",
                "localTime": "2015-08-06T07:52:27.376",
                "utcOffsetHours": 2,
                "latitude": 52.459254,
                "longitude": 9.694766,
                "elevationFeet": 183,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/HAJ?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/HAJ?codeType=fs"
            },
            {
                "fs": "NUX",
                "iata": "NUX",
                "name": "Novy Urengoy Airport",
                "city": "Novyj Urengoj",
                "cityCode": "NUX",
                "countryCode": "RU",
                "countryName": "Russian Federation",
                "regionName": "Europe",
                "timeZoneRegionName": "Asia/Yekaterinburg",
                "localTime": "2015-08-06T10:52:27.391",
                "utcOffsetHours": 5,
                "latitude": 66.073351,
                "longitude": 76.522831,
                "elevationFeet": 188,
                "classification": 4,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/NUX?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/NUX?codeType=fs"
            },
            {
                "fs": "VIE",
                "iata": "VIE",
                "icao": "LOWW",
                "name": "Vienna International Airport",
                "city": "Vienna",
                "cityCode": "VIE",
                "countryCode": "AT",
                "countryName": "Austria",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Vienna",
                "localTime": "2015-08-06T07:52:27.404",
                "utcOffsetHours": 2,
                "latitude": 48.11972,
                "longitude": 16.563583,
                "elevationFeet": 600,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/VIE?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/VIE?codeType=fs"
            },
            {
                "fs": "FRA",
                "iata": "FRA",
                "icao": "EDDF",
                "name": "Frankfurt am Main Airport",
                "city": "Frankfurt",
                "cityCode": "FRA",
                "countryCode": "DE",
                "countryName": "Germany",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Berlin",
                "localTime": "2015-08-06T07:52:27.372",
                "utcOffsetHours": 2,
                "latitude": 50.048952,
                "longitude": 8.573678,
                "elevationFeet": 381,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/FRA?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/FRA?codeType=fs"
            },
            {
                "fs": "ICN",
                "iata": "ICN",
                "icao": "RKSI",
                "name": "Incheon International Airport",
                "city": "Seoul",
                "cityCode": "SEL",
                "countryCode": "KR",
                "countryName": "Republic of Korea",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Seoul",
                "localTime": "2015-08-06T14:52:27.373",
                "utcOffsetHours": 9,
                "latitude": 37.448526,
                "longitude": 126.451234,
                "elevationFeet": 20,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/ICN?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/ICN?codeType=fs"
            },
            {
                "fs": "HAM",
                "iata": "HAM",
                "icao": "EDDH",
                "name": "Hamburg Airport",
                "city": "Hamburg",
                "cityCode": "HAM",
                "countryCode": "DE",
                "countryName": "Germany",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Berlin",
                "localTime": "2015-08-06T07:52:27.376",
                "utcOffsetHours": 2,
                "latitude": 53.631279,
                "longitude": 10.006414,
                "elevationFeet": 53,
                "classification": 2,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/HAM?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/HAM?codeType=fs"
            },
            {
                "fs": "ALA",
                "iata": "ALA",
                "icao": "UAAA",
                "name": "Almaty Airport",
                "city": "Almaty",
                "cityCode": "ALA",
                "countryCode": "KZ",
                "countryName": "Kazakhstan",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Qyzylorda",
                "localTime": "2015-08-06T11:52:27.367",
                "utcOffsetHours": 6,
                "latitude": 43.346652,
                "longitude": 77.011455,
                "elevationFeet": 2234,
                "classification": 3,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/ALA?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/ALA?codeType=fs"
            },
            {
                "fs": "PEK",
                "iata": "PEK",
                "icao": "ZBAA",
                "name": "Beijing Capital International Airport",
                "street1": "Capital Airport Rd",
                "city": "Beijing",
                "cityCode": "BJS",
                "countryCode": "CN",
                "countryName": "China",
                "regionName": "Asia",
                "timeZoneRegionName": "Asia/Shanghai",
                "localTime": "2015-08-06T13:52:27.392",
                "utcOffsetHours": 8,
                "latitude": 40.078538,
                "longitude": 116.587095,
                "elevationFeet": 115,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/PEK?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/PEK?codeType=fs"
            },
            {
                "fs": "CPH",
                "iata": "CPH",
                "icao": "EKCH",
                "name": "Copenhagen Airport",
                "city": "Copenhagen",
                "cityCode": "CPH",
                "countryCode": "DK",
                "countryName": "Denmark",
                "regionName": "Europe",
                "timeZoneRegionName": "Europe/Copenhagen",
                "localTime": "2015-08-06T07:52:27.371",
                "utcOffsetHours": 2,
                "latitude": 55.629053,
                "longitude": 12.647601,
                "elevationFeet": 17,
                "classification": 1,
                "active": true,
                "delayIndexUrl": "https://api.flightstats.com/flex/delayindex/rest/v1/json/airports/CPH?codeType=fs",
                "weatherUrl": "https://api.flightstats.com/flex/weather/rest/v1/json/all/CPH?codeType=fs"
            }
        ],
        "equipments": [
            {
                "iata": "73C",
                "name": "Boeing 737-300 (winglets) Passenger",
                "turboProp": false,
                "jet": true,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "73H",
                "name": "Boeing 737-800 (winglets) Passenger/BBJ2",
                "turboProp": false,
                "jet": true,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "B763",
                "name": "??",
                "turboProp": false,
                "jet": false,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "320",
                "name": "Airbus A320",
                "turboProp": false,
                "jet": true,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "74N",
                "name": "Boeing 747-8F Freighter",
                "turboProp": false,
                "jet": true,
                "widebody": true,
                "regional": false
            },
            {
                "iata": "332",
                "name": "Airbus A330-200",
                "turboProp": false,
                "jet": true,
                "widebody": true,
                "regional": false
            },
            {
                "iata": "321",
                "name": "Airbus A321",
                "turboProp": false,
                "jet": true,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "333",
                "name": "Airbus A330-300",
                "turboProp": false,
                "jet": true,
                "widebody": true,
                "regional": false
            },
            {
                "iata": "SU9",
                "name": "Sukhoi Superjet 100-95",
                "turboProp": false,
                "jet": true,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "77W",
                "name": "Boeing 777-300ER",
                "turboProp": false,
                "jet": true,
                "widebody": true,
                "regional": false
            },
            {
                "iata": "76W",
                "name": "Boeing 767-300 (winglets) Passenger",
                "turboProp": false,
                "jet": true,
                "widebody": true,
                "regional": false
            },
            {
                "iata": "735",
                "name": "Boeing 737-500 Passenger",
                "turboProp": false,
                "jet": true,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "319",
                "name": "Airbus A319",
                "turboProp": false,
                "jet": true,
                "widebody": false,
                "regional": false
            },
            {
                "iata": "74Y",
                "name": "Boeing 747-400 Freighter",
                "turboProp": false,
                "jet": true,
                "widebody": true,
                "regional": false
            }
        ]
    },
    "flightStatuses": [
        {
            "flightId": 580969902,
            "carrierFsCode": "SU",
            "flightNumber": "1546",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "AAQ",
            "departureDate": {
                "dateLocal": "2015-08-06T08:25:00.000",
                "dateUtc": "2015-08-06T05:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:40:00.000",
                "dateUtc": "2015-08-06T07:40:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:36:00.000",
                    "dateUtc": "2015-08-06T05:36:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:36:00.000",
                    "dateUtc": "2015-08-06T05:36:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:37:00.000",
                    "dateUtc": "2015-08-06T05:37:00.000Z"
                },
                "actualRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:37:00.000",
                    "dateUtc": "2015-08-06T05:37:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:51:00.000",
                    "dateUtc": "2015-08-06T07:51:00.000Z"
                }
            },
            "delays": {
                "departureGateDelayMinutes": 11,
                "arrivalGateDelayMinutes": 11
            },
            "flightDurations": {
                "scheduledBlockMinutes": 135,
                "taxiOutMinutes": 1
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969899,
            "carrierFsCode": "5N",
            "flightNumber": "549",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "AAQ",
            "departureDate": {
                "dateLocal": "2015-08-06T10:45:00.000",
                "dateUtc": "2015-08-06T07:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:05:00.000",
                "dateUtc": "2015-08-06T10:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 140
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "17"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "735"
            }
        },
        {
            "flightId": 580969910,
            "carrierFsCode": "SU",
            "flightNumber": "1134",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "AER",
            "departureDate": {
                "dateLocal": "2015-08-06T09:00:00.000",
                "dateUtc": "2015-08-06T06:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:40:00.000",
                "dateUtc": "2015-08-06T08:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 160
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580969905,
            "carrierFsCode": "SU",
            "flightNumber": "1122",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "AER",
            "departureDate": {
                "dateLocal": "2015-08-06T12:35:00.000",
                "dateUtc": "2015-08-06T09:35:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:05:00.000",
                "dateUtc": "2015-08-06T12:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:35:00.000",
                    "dateUtc": "2015-08-06T09:35:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T12:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:35:00.000",
                    "dateUtc": "2015-08-06T09:35:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:35:00.000",
                    "dateUtc": "2015-08-06T09:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T12:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T12:05:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4900",
                    "relationship": "L"
                },
                {
                    "fsCode": "JU",
                    "flightNumber": "8144",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3192",
                    "relationship": "L"
                },
                {
                    "fsCode": "MU",
                    "flightNumber": "8167",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 150
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "20"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "332"
            }
        },
        {
            "flightId": 580969911,
            "carrierFsCode": "SU",
            "flightNumber": "2720",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "AGP",
            "departureDate": {
                "dateLocal": "2015-08-06T10:00:00.000",
                "dateUtc": "2015-08-06T07:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:35:00.000",
                "dateUtc": "2015-08-06T12:35:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "G",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:35:00.000",
                    "dateUtc": "2015-08-06T12:35:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:35:00.000",
                    "dateUtc": "2015-08-06T12:35:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:35:00.000",
                    "dateUtc": "2015-08-06T12:35:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "UX",
                    "flightNumber": "3298",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 335
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "44",
                "arrivalTerminal": "1",
                "baggage": "33"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580969913,
            "carrierFsCode": "KC",
            "flightNumber": "872",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "ALA",
            "departureDate": {
                "dateLocal": "2015-08-06T09:10:00.000",
                "dateUtc": "2015-08-06T06:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T16:35:00.000",
                "dateUtc": "2015-08-06T10:35:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "FJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:10:00.000",
                    "dateUtc": "2015-08-06T06:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T16:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:10:00.000",
                    "dateUtc": "2015-08-06T06:10:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T16:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T16:27:00.000",
                    "dateUtc": "2015-08-06T10:27:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 265
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "37"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969916,
            "carrierFsCode": "SU",
            "flightNumber": "2550",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "AMS",
            "departureDate": {
                "dateLocal": "2015-08-06T09:20:00.000",
                "dateUtc": "2015-08-06T06:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:00:00.000",
                "dateUtc": "2015-08-06T10:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "FI",
                    "flightNumber": "7231",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3181",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 220
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "36"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969922,
            "carrierFsCode": "SU",
            "flightNumber": "1332",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "ARH",
            "departureDate": {
                "dateLocal": "2015-08-06T08:10:00.000",
                "dateUtc": "2015-08-06T05:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:10:00.000",
                "dateUtc": "2015-08-06T07:10:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:10:00.000",
                    "dateUtc": "2015-08-06T05:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:10:00.000",
                    "dateUtc": "2015-08-06T05:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "KL",
                    "flightNumber": "2860",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 35
            },
            "flightDurations": {
                "scheduledBlockMinutes": 120
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "21"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "SU9"
            }
        },
        {
            "flightId": 580969927,
            "carrierFsCode": "SU",
            "flightNumber": "2210",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "ARN",
            "departureDate": {
                "dateLocal": "2015-08-06T09:50:00.000",
                "dateUtc": "2015-08-06T06:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:00:00.000",
                "dateUtc": "2015-08-06T09:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:00:00.000",
                    "dateUtc": "2015-08-06T09:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:00:00.000",
                    "dateUtc": "2015-08-06T09:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:00:00.000",
                    "dateUtc": "2015-08-06T09:00:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "FI",
                    "flightNumber": "7221",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 130
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "32",
                "arrivalTerminal": "5",
                "arrivalGate": "18"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969934,
            "carrierFsCode": "SU",
            "flightNumber": "2142",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "AYT",
            "departureDate": {
                "dateLocal": "2015-08-06T08:45:00.000",
                "dateUtc": "2015-08-06T05:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:25:00.000",
                "dateUtc": "2015-08-06T09:25:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:42:00.000",
                    "dateUtc": "2015-08-06T05:42:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:42:00.000",
                    "dateUtc": "2015-08-06T05:42:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 220
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "55",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969941,
            "carrierFsCode": "SU",
            "flightNumber": "2514",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "BCN",
            "departureDate": {
                "dateLocal": "2015-08-06T12:20:00.000",
                "dateUtc": "2015-08-06T09:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:50:00.000",
                "dateUtc": "2015-08-06T13:50:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:20:00.000",
                    "dateUtc": "2015-08-06T09:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:50:00.000",
                    "dateUtc": "2015-08-06T13:50:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:20:00.000",
                    "dateUtc": "2015-08-06T09:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:20:00.000",
                    "dateUtc": "2015-08-06T09:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:50:00.000",
                    "dateUtc": "2015-08-06T13:50:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:50:00.000",
                    "dateUtc": "2015-08-06T13:50:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "UX",
                    "flightNumber": "3245",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 270
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "26",
                "arrivalTerminal": "1",
                "baggage": "13"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969944,
            "carrierFsCode": "SU",
            "flightNumber": "2090",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "BEG",
            "departureDate": {
                "dateLocal": "2015-08-06T10:25:00.000",
                "dateUtc": "2015-08-06T07:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:25:00.000",
                "dateUtc": "2015-08-06T10:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T10:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T10:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T10:25:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "JU",
                    "flightNumber": "8133",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 180
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "53",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969949,
            "carrierFsCode": "SU",
            "flightNumber": "2424",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "BLQ",
            "departureDate": {
                "dateLocal": "2015-08-06T08:05:00.000",
                "dateUtc": "2015-08-06T05:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:30:00.000",
                "dateUtc": "2015-08-06T08:30:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:23:00.000",
                    "dateUtc": "2015-08-06T05:23:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:23:00.000",
                    "dateUtc": "2015-08-06T05:23:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T08:15:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AZ",
                    "flightNumber": "7167",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 18
            },
            "flightDurations": {
                "scheduledBlockMinutes": 205
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "33"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969950,
            "carrierFsCode": "SU",
            "flightNumber": "2168",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "BRU",
            "departureDate": {
                "dateLocal": "2015-08-06T09:00:00.000",
                "dateUtc": "2015-08-06T06:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:25:00.000",
                "dateUtc": "2015-08-06T09:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 205
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "43"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969953,
            "carrierFsCode": "SU",
            "flightNumber": "2030",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "BUD",
            "departureDate": {
                "dateLocal": "2015-08-06T10:20:00.000",
                "dateUtc": "2015-08-06T07:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:00:00.000",
                "dateUtc": "2015-08-06T10:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 160
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "58",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580969956,
            "carrierFsCode": "AF",
            "flightNumber": "1145",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "CDG",
            "departureDate": {
                "dateLocal": "2015-08-06T08:45:00.000",
                "dateUtc": "2015-08-06T05:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:45:00.000",
                "dateUtc": "2015-08-06T09:45:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:39:00.000",
                    "dateUtc": "2015-08-06T05:39:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:39:00.000",
                    "dateUtc": "2015-08-06T05:39:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:19:00.000",
                    "dateUtc": "2015-08-06T09:19:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "SU",
                    "flightNumber": "4450",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 240
            },
            "airportResources": {
                "departureTerminal": "E",
                "arrivalTerminal": "2E"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969959,
            "carrierFsCode": "SU",
            "flightNumber": "2454",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "CDG",
            "departureDate": {
                "dateLocal": "2015-08-06T10:10:00.000",
                "dateUtc": "2015-08-06T07:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:10:00.000",
                "dateUtc": "2015-08-06T11:10:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:10:00.000",
                    "dateUtc": "2015-08-06T11:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:10:00.000",
                    "dateUtc": "2015-08-06T11:10:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:10:00.000",
                    "dateUtc": "2015-08-06T11:10:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4899",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 240
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "5",
                "arrivalTerminal": "2C"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969963,
            "carrierFsCode": "SU",
            "flightNumber": "2462",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "CDG",
            "departureDate": {
                "dateLocal": "2015-08-06T11:45:00.000",
                "dateUtc": "2015-08-06T08:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:40:00.000",
                "dateUtc": "2015-08-06T12:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T08:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:40:00.000",
                    "dateUtc": "2015-08-06T12:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T08:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T08:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:40:00.000",
                    "dateUtc": "2015-08-06T12:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:40:00.000",
                    "dateUtc": "2015-08-06T12:40:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4855",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 235
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "27",
                "arrivalTerminal": "2C"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969970,
            "carrierFsCode": "SU",
            "flightNumber": "2658",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "CPH",
            "departureDate": {
                "dateLocal": "2015-08-06T09:55:00.000",
                "dateUtc": "2015-08-06T06:55:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:30:00.000",
                "dateUtc": "2015-08-06T09:30:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:55:00.000",
                    "dateUtc": "2015-08-06T06:55:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T09:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:55:00.000",
                    "dateUtc": "2015-08-06T06:55:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:55:00.000",
                    "dateUtc": "2015-08-06T06:55:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T09:30:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T09:30:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "FI",
                    "flightNumber": "7211",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 155
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "35",
                "arrivalTerminal": "3"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969972,
            "carrierFsCode": "RU",
            "flightNumber": "485",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "CTU",
            "departureDate": {
                "dateLocal": "2015-08-06T12:45:00.000",
                "dateUtc": "2015-08-06T09:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-07T01:35:00.000",
                "dateUtc": "2015-08-06T17:35:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-07T01:35:00.000",
                    "dateUtc": "2015-08-06T17:35:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-07T01:35:00.000",
                    "dateUtc": "2015-08-06T17:35:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 470
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74Y"
            }
        },
        {
            "flightId": 580969976,
            "carrierFsCode": "SU",
            "flightNumber": "2152",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "DUS",
            "departureDate": {
                "dateLocal": "2015-08-06T11:35:00.000",
                "dateUtc": "2015-08-06T08:35:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:50:00.000",
                "dateUtc": "2015-08-06T11:50:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:35:00.000",
                    "dateUtc": "2015-08-06T08:35:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:50:00.000",
                    "dateUtc": "2015-08-06T11:50:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:35:00.000",
                    "dateUtc": "2015-08-06T08:35:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:35:00.000",
                    "dateUtc": "2015-08-06T08:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:50:00.000",
                    "dateUtc": "2015-08-06T11:50:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:50:00.000",
                    "dateUtc": "2015-08-06T11:50:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 195
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "30"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969981,
            "carrierFsCode": "SU",
            "flightNumber": "1860",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "EVN",
            "departureDate": {
                "dateLocal": "2015-08-06T10:10:00.000",
                "dateUtc": "2015-08-06T07:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:00:00.000",
                "dateUtc": "2015-08-06T10:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:10:00.000",
                    "dateUtc": "2015-08-06T07:10:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "KL",
                    "flightNumber": "2958",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 170
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "26"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969988,
            "carrierFsCode": "SU",
            "flightNumber": "2402",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "FCO",
            "departureDate": {
                "dateLocal": "2015-08-06T08:50:00.000",
                "dateUtc": "2015-08-06T05:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:40:00.000",
                "dateUtc": "2015-08-06T09:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:50:00.000",
                    "dateUtc": "2015-08-06T05:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T09:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:50:00.000",
                    "dateUtc": "2015-08-06T05:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:50:00.000",
                    "dateUtc": "2015-08-06T05:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T09:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T09:40:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AZ",
                    "flightNumber": "7183",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 230
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "6",
                "arrivalTerminal": "3",
                "baggage": "7"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969987,
            "carrierFsCode": "SU",
            "flightNumber": "2406",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "FCO",
            "departureDate": {
                "dateLocal": "2015-08-06T11:30:00.000",
                "dateUtc": "2015-08-06T08:30:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:20:00.000",
                "dateUtc": "2015-08-06T12:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:20:00.000",
                    "dateUtc": "2015-08-06T12:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:20:00.000",
                    "dateUtc": "2015-08-06T12:20:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:20:00.000",
                    "dateUtc": "2015-08-06T12:20:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AZ",
                    "flightNumber": "7017",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 230
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "32",
                "arrivalTerminal": "3",
                "baggage": "5"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580969989,
            "carrierFsCode": "RU",
            "flightNumber": "417",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "FRA",
            "departureDate": {
                "dateLocal": "2015-08-06T08:05:00.000",
                "dateUtc": "2015-08-06T05:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:25:00.000",
                "dateUtc": "2015-08-06T08:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 200
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74Y"
            }
        },
        {
            "flightId": 580969992,
            "carrierFsCode": "SU",
            "flightNumber": "2306",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "FRA",
            "departureDate": {
                "dateLocal": "2015-08-06T08:05:00.000",
                "dateUtc": "2015-08-06T05:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:30:00.000",
                "dateUtc": "2015-08-06T08:30:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:21:00.000",
                    "dateUtc": "2015-08-06T05:21:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:21:00.000",
                    "dateUtc": "2015-08-06T05:21:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:46:00.000",
                    "dateUtc": "2015-08-06T08:46:00.000Z"
                }
            },
            "delays": {
                "departureGateDelayMinutes": 16,
                "arrivalGateDelayMinutes": 16
            },
            "flightDurations": {
                "scheduledBlockMinutes": 205
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "26",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969990,
            "carrierFsCode": "SU",
            "flightNumber": "2300",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "FRA",
            "departureDate": {
                "dateLocal": "2015-08-06T10:15:00.000",
                "dateUtc": "2015-08-06T07:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:40:00.000",
                "dateUtc": "2015-08-06T10:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 205
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "31",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580969994,
            "carrierFsCode": "KE",
            "flightNumber": "529",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "FRA",
            "departureDate": {
                "dateLocal": "2015-08-06T12:45:00.000",
                "dateUtc": "2015-08-06T09:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:55:00.000",
                "dateUtc": "2015-08-06T12:55:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": "",
                "uplines": [
                    {
                        "fsCode": "ICN",
                        "flightId": 580927271
                    }
                ]
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:55:00.000",
                    "dateUtc": "2015-08-06T12:55:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:55:00.000",
                    "dateUtc": "2015-08-06T12:55:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 190
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74Y"
            }
        },
        {
            "flightId": 580969995,
            "carrierFsCode": "SU",
            "flightNumber": "1880",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "FRU",
            "departureDate": {
                "dateLocal": "2015-08-06T08:05:00.000",
                "dateUtc": "2015-08-06T05:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:10:00.000",
                "dateUtc": "2015-08-06T09:10:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:05:00.000",
                    "dateUtc": "2015-08-06T05:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:20:00.000",
                    "dateUtc": "2015-08-06T05:20:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:20:00.000",
                    "dateUtc": "2015-08-06T05:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4974",
                    "relationship": "L"
                },
                {
                    "fsCode": "AZ",
                    "flightNumber": "5664",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "2936",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 15,
                "arrivalGateDelayMinutes": 15
            },
            "flightDurations": {
                "scheduledBlockMinutes": 245
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "23"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580969998,
            "carrierFsCode": "SU",
            "flightNumber": "1152",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "GDZ",
            "departureDate": {
                "dateLocal": "2015-08-06T08:25:00.000",
                "dateUtc": "2015-08-06T05:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:45:00.000",
                "dateUtc": "2015-08-06T07:45:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:39:00.000",
                    "dateUtc": "2015-08-06T05:39:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:39:00.000",
                    "dateUtc": "2015-08-06T05:39:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:59:00.000",
                    "dateUtc": "2015-08-06T07:59:00.000Z"
                }
            },
            "delays": {
                "departureGateDelayMinutes": 14,
                "arrivalGateDelayMinutes": 14
            },
            "flightDurations": {
                "scheduledBlockMinutes": 140
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "3"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580969997,
            "carrierFsCode": "SU",
            "flightNumber": "1782",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "GDZ",
            "departureDate": {
                "dateLocal": "2015-08-06T10:30:00.000",
                "dateUtc": "2015-08-06T07:30:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:00:00.000",
                "dateUtc": "2015-08-06T10:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "G",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 150
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "14"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970001,
            "carrierFsCode": "SU",
            "flightNumber": "1220",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "GOJ",
            "departureDate": {
                "dateLocal": "2015-08-06T09:50:00.000",
                "dateUtc": "2015-08-06T06:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:05:00.000",
                "dateUtc": "2015-08-06T08:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:05:00.000",
                    "dateUtc": "2015-08-06T08:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:05:00.000",
                    "dateUtc": "2015-08-06T08:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:05:00.000",
                    "dateUtc": "2015-08-06T08:05:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "KL",
                    "flightNumber": "3246",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 75
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "12"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970006,
            "carrierFsCode": "SU",
            "flightNumber": "2380",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "GVA",
            "departureDate": {
                "dateLocal": "2015-08-06T09:05:00.000",
                "dateUtc": "2015-08-06T06:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:45:00.000",
                "dateUtc": "2015-08-06T09:45:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 220
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "52",
                "arrivalTerminal": "M",
                "baggage": "3"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970008,
            "carrierFsCode": "SU",
            "flightNumber": "1854",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "GYD",
            "departureDate": {
                "dateLocal": "2015-08-06T10:15:00.000",
                "dateUtc": "2015-08-06T07:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:20:00.000",
                "dateUtc": "2015-08-06T10:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T10:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T10:20:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T10:20:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "DL",
                    "flightNumber": "8212",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "2932",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 185
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "51",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970009,
            "carrierFsCode": "SU",
            "flightNumber": "2342",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "HAJ",
            "departureDate": {
                "dateLocal": "2015-08-06T10:45:00.000",
                "dateUtc": "2015-08-06T07:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:40:00.000",
                "dateUtc": "2015-08-06T10:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 175
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "24"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970011,
            "carrierFsCode": "SU",
            "flightNumber": "2346",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "HAM",
            "departureDate": {
                "dateLocal": "2015-08-06T09:25:00.000",
                "dateUtc": "2015-08-06T06:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:15:00.000",
                "dateUtc": "2015-08-06T09:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 170
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "6",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970014,
            "carrierFsCode": "SU",
            "flightNumber": "2206",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "HEL",
            "departureDate": {
                "dateLocal": "2015-08-06T10:40:00.000",
                "dateUtc": "2015-08-06T07:40:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:30:00.000",
                "dateUtc": "2015-08-06T09:30:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:30:00.000",
                    "dateUtc": "2015-08-06T09:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:30:00.000",
                    "dateUtc": "2015-08-06T09:30:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:30:00.000",
                    "dateUtc": "2015-08-06T09:30:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AY",
                    "flightNumber": "6840",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 110
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "6",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970016,
            "carrierFsCode": "AY",
            "flightNumber": "154",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "HEL",
            "departureDate": {
                "dateLocal": "2015-08-06T11:50:00.000",
                "dateUtc": "2015-08-06T08:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:30:00.000",
                "dateUtc": "2015-08-06T10:30:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:50:00.000",
                    "dateUtc": "2015-08-06T08:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:30:00.000",
                    "dateUtc": "2015-08-06T10:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:50:00.000",
                    "dateUtc": "2015-08-06T08:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:30:00.000",
                    "dateUtc": "2015-08-06T10:30:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "JL",
                    "flightNumber": "6862",
                    "relationship": "L"
                },
                {
                    "fsCode": "SU",
                    "flightNumber": "3660",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 100
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "29",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970018,
            "carrierFsCode": "RU",
            "flightNumber": "439",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "HKG",
            "departureDate": {
                "dateLocal": "2015-08-06T08:25:00.000",
                "dateUtc": "2015-08-06T05:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T22:30:00.000",
                "dateUtc": "2015-08-06T14:30:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T22:30:00.000",
                    "dateUtc": "2015-08-06T14:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T22:30:00.000",
                    "dateUtc": "2015-08-06T14:30:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 545
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74N"
            }
        },
        {
            "flightId": 580970019,
            "carrierFsCode": "RU",
            "flightNumber": "449",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "HKG",
            "departureDate": {
                "dateLocal": "2015-08-06T12:15:00.000",
                "dateUtc": "2015-08-06T09:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-07T02:20:00.000",
                "dateUtc": "2015-08-06T18:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-07T02:20:00.000",
                    "dateUtc": "2015-08-06T18:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-07T02:20:00.000",
                    "dateUtc": "2015-08-06T18:20:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 545
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74Y"
            }
        },
        {
            "flightId": 580970022,
            "carrierFsCode": "SU",
            "flightNumber": "104",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "IAD",
            "departureDate": {
                "dateLocal": "2015-08-06T09:25:00.000",
                "dateUtc": "2015-08-06T06:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:55:00.000",
                "dateUtc": "2015-08-06T16:55:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T16:55:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "flightPlanPlannedDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T16:55:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:05:00.000",
                    "dateUtc": "2015-08-06T18:05:00.000Z"
                },
                "flightPlanPlannedArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T18:00:00.000Z"
                },
                "estimatedRunwayArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T18:00:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "DL",
                    "flightNumber": "8175",
                    "relationship": "L"
                }
            ],
            "delays": {
                "arrivalGateDelayMinutes": 70
            },
            "flightDurations": {
                "scheduledBlockMinutes": 630,
                "scheduledAirMinutes": 685,
                "scheduledTaxiOutMinutes": 10
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "28"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "333"
            }
        },
        {
            "flightId": 580970029,
            "carrierFsCode": "SU",
            "flightNumber": "2130",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "IST",
            "departureDate": {
                "dateLocal": "2015-08-06T08:00:00.000",
                "dateUtc": "2015-08-06T05:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:40:00.000",
                "dateUtc": "2015-08-06T08:40:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:00:00.000",
                    "dateUtc": "2015-08-06T05:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:00:00.000",
                    "dateUtc": "2015-08-06T05:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:12:00.000",
                    "dateUtc": "2015-08-06T05:12:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:12:00.000",
                    "dateUtc": "2015-08-06T05:12:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:12:00.000",
                    "dateUtc": "2015-08-06T05:12:00.000Z"
                },
                "actualRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:12:00.000",
                    "dateUtc": "2015-08-06T05:12:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                }
            },
            "delays": {
                "departureGateDelayMinutes": 12
            },
            "flightDurations": {
                "scheduledBlockMinutes": 220,
                "taxiOutMinutes": 0
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "53",
                "arrivalTerminal": "I"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970032,
            "carrierFsCode": "SU",
            "flightNumber": "2136",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "IST",
            "departureDate": {
                "dateLocal": "2015-08-06T10:00:00.000",
                "dateUtc": "2015-08-06T07:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:40:00.000",
                "dateUtc": "2015-08-06T10:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:40:00.000",
                    "dateUtc": "2015-08-06T10:40:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 220
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "54",
                "arrivalTerminal": "I"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970035,
            "carrierFsCode": "SU",
            "flightNumber": "100",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "JFK",
            "departureDate": {
                "dateLocal": "2015-08-06T09:25:00.000",
                "dateUtc": "2015-08-06T06:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:25:00.000",
                "dateUtc": "2015-08-06T16:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T16:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:25:00.000",
                    "dateUtc": "2015-08-06T06:25:00.000Z"
                },
                "flightPlanPlannedDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T16:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T16:25:00.000Z"
                },
                "flightPlanPlannedArrival": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T15:55:00.000Z"
                },
                "estimatedRunwayArrival": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T15:55:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "DL",
                    "flightNumber": "1012",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 600,
                "scheduledAirMinutes": 560,
                "scheduledTaxiOutMinutes": 10,
                "scheduledTaxiInMinutes": 30
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "25",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "333"
            }
        },
        {
            "flightId": 580970034,
            "carrierFsCode": "DL",
            "flightNumber": "467",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "JFK",
            "departureDate": {
                "dateLocal": "2015-08-06T12:10:00.000",
                "dateUtc": "2015-08-06T09:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:20:00.000",
                "dateUtc": "2015-08-06T19:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "JY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T19:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:05:00.000",
                    "dateUtc": "2015-08-06T09:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T19:20:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T19:20:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "SU",
                    "flightNumber": "4040",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 610
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "23",
                "arrivalTerminal": "4"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "76W",
                "actualEquipmentIataCode": "B763"
            }
        },
        {
            "flightId": 580970038,
            "carrierFsCode": "SU",
            "flightNumber": "1804",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KBP",
            "departureDate": {
                "dateLocal": "2015-08-06T08:55:00.000",
                "dateUtc": "2015-08-06T05:55:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:30:00.000",
                "dateUtc": "2015-08-06T07:30:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:55:00.000",
                    "dateUtc": "2015-08-06T05:55:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:55:00.000",
                    "dateUtc": "2015-08-06T05:55:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:55:00.000",
                    "dateUtc": "2015-08-06T05:55:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:31:00.000",
                    "dateUtc": "2015-08-06T07:31:00.000Z"
                }
            },
            "delays": {
                "arrivalGateDelayMinutes": 1
            },
            "flightDurations": {
                "scheduledBlockMinutes": 95
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "31",
                "arrivalTerminal": "D"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "SU9"
            }
        },
        {
            "flightId": 580970036,
            "carrierFsCode": "SU",
            "flightNumber": "1806",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KBP",
            "departureDate": {
                "dateLocal": "2015-08-06T11:30:00.000",
                "dateUtc": "2015-08-06T08:30:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:05:00.000",
                "dateUtc": "2015-08-06T10:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 95
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "7",
                "arrivalTerminal": "D"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "SU9"
            }
        },
        {
            "flightId": 580970044,
            "carrierFsCode": "SU",
            "flightNumber": "1002",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KGD",
            "departureDate": {
                "dateLocal": "2015-08-06T10:25:00.000",
                "dateUtc": "2015-08-06T07:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:25:00.000",
                "dateUtc": "2015-08-06T09:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4901",
                    "relationship": "L"
                },
                {
                    "fsCode": "DL",
                    "flightNumber": "8179",
                    "relationship": "L"
                },
                {
                    "fsCode": "MU",
                    "flightNumber": "8170",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 120
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "16"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970063,
            "carrierFsCode": "SU",
            "flightNumber": "1272",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KRR",
            "departureDate": {
                "dateLocal": "2015-08-06T08:20:00.000",
                "dateUtc": "2015-08-06T05:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:40:00.000",
                "dateUtc": "2015-08-06T07:40:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:20:00.000",
                    "dateUtc": "2015-08-06T05:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:20:00.000",
                    "dateUtc": "2015-08-06T05:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:31:00.000",
                    "dateUtc": "2015-08-06T05:31:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:31:00.000",
                    "dateUtc": "2015-08-06T05:31:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:31:00.000",
                    "dateUtc": "2015-08-06T05:31:00.000Z"
                },
                "actualRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:31:00.000",
                    "dateUtc": "2015-08-06T05:31:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:51:00.000",
                    "dateUtc": "2015-08-06T07:51:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4944",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3220",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 11,
                "arrivalGateDelayMinutes": 11
            },
            "flightDurations": {
                "scheduledBlockMinutes": 140,
                "taxiOutMinutes": 0
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970058,
            "carrierFsCode": "SU",
            "flightNumber": "1102",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KRR",
            "departureDate": {
                "dateLocal": "2015-08-06T10:50:00.000",
                "dateUtc": "2015-08-06T07:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:55:00.000",
                "dateUtc": "2015-08-06T09:55:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4910",
                    "relationship": "L"
                },
                {
                    "fsCode": "DL",
                    "flightNumber": "8180",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3062",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 125
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "19"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970056,
            "carrierFsCode": "5N",
            "flightNumber": "547",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KRR",
            "departureDate": {
                "dateLocal": "2015-08-06T12:55:00.000",
                "dateUtc": "2015-08-06T09:55:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:20:00.000",
                "dateUtc": "2015-08-06T12:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T12:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T12:20:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:20:00.000",
                    "dateUtc": "2015-08-06T12:20:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 145
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "735"
            }
        },
        {
            "flightId": 580970068,
            "carrierFsCode": "SU",
            "flightNumber": "1210",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KUF",
            "departureDate": {
                "dateLocal": "2015-08-06T08:00:00.000",
                "dateUtc": "2015-08-06T05:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:45:00.000",
                "dateUtc": "2015-08-06T06:45:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:00:00.000",
                    "dateUtc": "2015-08-06T05:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:00:00.000",
                    "dateUtc": "2015-08-06T05:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:13:00.000",
                    "dateUtc": "2015-08-06T05:13:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:13:00.000",
                    "dateUtc": "2015-08-06T05:13:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:59:00.000",
                    "dateUtc": "2015-08-06T06:59:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4908",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3190",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 13,
                "arrivalGateDelayMinutes": 14
            },
            "flightDurations": {
                "scheduledBlockMinutes": 105
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "16"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970064,
            "carrierFsCode": "SU",
            "flightNumber": "1208",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KUF",
            "departureDate": {
                "dateLocal": "2015-08-06T09:45:00.000",
                "dateUtc": "2015-08-06T06:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:25:00.000",
                "dateUtc": "2015-08-06T08:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 100
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "18"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970074,
            "carrierFsCode": "SU",
            "flightNumber": "1268",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KZN",
            "departureDate": {
                "dateLocal": "2015-08-06T08:15:00.000",
                "dateUtc": "2015-08-06T05:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T09:45:00.000",
                "dateUtc": "2015-08-06T06:45:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:15:00.000",
                    "dateUtc": "2015-08-06T05:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T09:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:15:00.000",
                    "dateUtc": "2015-08-06T05:15:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:28:00.000",
                    "dateUtc": "2015-08-06T05:28:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:28:00.000",
                    "dateUtc": "2015-08-06T05:28:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T09:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T09:58:00.000",
                    "dateUtc": "2015-08-06T06:58:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "KL",
                    "flightNumber": "2873",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 13,
                "arrivalGateDelayMinutes": 13
            },
            "flightDurations": {
                "scheduledBlockMinutes": 90
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "18",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970070,
            "carrierFsCode": "SU",
            "flightNumber": "1190",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "KZN",
            "departureDate": {
                "dateLocal": "2015-08-06T09:10:00.000",
                "dateUtc": "2015-08-06T06:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:40:00.000",
                "dateUtc": "2015-08-06T07:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:10:00.000",
                    "dateUtc": "2015-08-06T06:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:10:00.000",
                    "dateUtc": "2015-08-06T06:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:10:00.000",
                    "dateUtc": "2015-08-06T06:10:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:40:00.000",
                    "dateUtc": "2015-08-06T07:40:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4940",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3278",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 90
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "15",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970076,
            "carrierFsCode": "SU",
            "flightNumber": "106",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LAX",
            "departureDate": {
                "dateLocal": "2015-08-06T12:45:00.000",
                "dateUtc": "2015-08-06T09:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:05:00.000",
                "dateUtc": "2015-08-06T22:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T22:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "flightPlanPlannedDeparture": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T12:55:00.000",
                    "dateUtc": "2015-08-06T09:55:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T22:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T22:05:00.000Z"
                },
                "flightPlanPlannedArrival": {
                    "dateLocal": "2015-08-06T14:13:00.000",
                    "dateUtc": "2015-08-06T21:13:00.000Z"
                },
                "estimatedRunwayArrival": {
                    "dateLocal": "2015-08-06T14:13:00.000",
                    "dateUtc": "2015-08-06T21:13:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "DL",
                    "flightNumber": "8177",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 740,
                "scheduledAirMinutes": 678,
                "scheduledTaxiOutMinutes": 10,
                "scheduledTaxiInMinutes": 52
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "22",
                "arrivalTerminal": "TBIT"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "77W"
            }
        },
        {
            "flightId": 580970078,
            "carrierFsCode": "SU",
            "flightNumber": "2072",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LCA",
            "departureDate": {
                "dateLocal": "2015-08-06T10:05:00.000",
                "dateUtc": "2015-08-06T07:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:00:00.000",
                "dateUtc": "2015-08-06T11:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T11:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T11:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:00:00.000",
                    "dateUtc": "2015-08-06T11:00:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 235
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "39"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970091,
            "carrierFsCode": "SU",
            "flightNumber": "10",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LED",
            "departureDate": {
                "dateLocal": "2015-08-06T08:25:00.000",
                "dateUtc": "2015-08-06T05:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T09:45:00.000",
                "dateUtc": "2015-08-06T06:45:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T09:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:25:00.000",
                    "dateUtc": "2015-08-06T05:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:41:00.000",
                    "dateUtc": "2015-08-06T05:41:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:41:00.000",
                    "dateUtc": "2015-08-06T05:41:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T09:45:00.000",
                    "dateUtc": "2015-08-06T06:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:01:00.000",
                    "dateUtc": "2015-08-06T07:01:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "MU",
                    "flightNumber": "8173",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 16,
                "arrivalGateDelayMinutes": 16
            },
            "flightDurations": {
                "scheduledBlockMinutes": 80
            },
            "airportResources": {
                "departureTerminal": "D",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970090,
            "carrierFsCode": "SU",
            "flightNumber": "12",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LED",
            "departureDate": {
                "dateLocal": "2015-08-06T09:50:00.000",
                "dateUtc": "2015-08-06T06:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:15:00.000",
                "dateUtc": "2015-08-06T08:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T08:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:50:00.000",
                    "dateUtc": "2015-08-06T06:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T08:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T08:15:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 85
            },
            "airportResources": {
                "departureTerminal": "D",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970089,
            "carrierFsCode": "SU",
            "flightNumber": "14",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LED",
            "departureDate": {
                "dateLocal": "2015-08-06T10:55:00.000",
                "dateUtc": "2015-08-06T07:55:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:15:00.000",
                "dateUtc": "2015-08-06T09:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:55:00.000",
                    "dateUtc": "2015-08-06T07:55:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:55:00.000",
                    "dateUtc": "2015-08-06T07:55:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:55:00.000",
                    "dateUtc": "2015-08-06T07:55:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "DL",
                    "flightNumber": "8216",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 80
            },
            "airportResources": {
                "departureTerminal": "D",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970088,
            "carrierFsCode": "SU",
            "flightNumber": "16",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LED",
            "departureDate": {
                "dateLocal": "2015-08-06T11:40:00.000",
                "dateUtc": "2015-08-06T08:40:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:00:00.000",
                "dateUtc": "2015-08-06T10:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:00:00.000",
                    "dateUtc": "2015-08-06T10:00:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "DL",
                    "flightNumber": "8182",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 80
            },
            "airportResources": {
                "departureTerminal": "D",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970087,
            "carrierFsCode": "SU",
            "flightNumber": "18",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LED",
            "departureDate": {
                "dateLocal": "2015-08-06T12:50:00.000",
                "dateUtc": "2015-08-06T09:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:10:00.000",
                "dateUtc": "2015-08-06T11:10:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:50:00.000",
                    "dateUtc": "2015-08-06T09:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:10:00.000",
                    "dateUtc": "2015-08-06T11:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:50:00.000",
                    "dateUtc": "2015-08-06T09:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:50:00.000",
                    "dateUtc": "2015-08-06T09:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:10:00.000",
                    "dateUtc": "2015-08-06T11:10:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:10:00.000",
                    "dateUtc": "2015-08-06T11:10:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "JU",
                    "flightNumber": "8142",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 80
            },
            "airportResources": {
                "departureTerminal": "D",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970098,
            "carrierFsCode": "SU",
            "flightNumber": "2578",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "LHR",
            "departureDate": {
                "dateLocal": "2015-08-06T10:05:00.000",
                "dateUtc": "2015-08-06T07:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:05:00.000",
                "dateUtc": "2015-08-06T11:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:05:00.000",
                    "dateUtc": "2015-08-06T11:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:05:00.000",
                    "dateUtc": "2015-08-06T11:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:05:00.000",
                    "dateUtc": "2015-08-06T11:05:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 240
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "30",
                "arrivalTerminal": "4"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "333"
            }
        },
        {
            "flightId": 580970111,
            "carrierFsCode": "SU",
            "flightNumber": "1310",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "MRV",
            "departureDate": {
                "dateLocal": "2015-08-06T09:40:00.000",
                "dateUtc": "2015-08-06T06:40:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:55:00.000",
                "dateUtc": "2015-08-06T08:55:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:40:00.000",
                    "dateUtc": "2015-08-06T06:40:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T08:55:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:40:00.000",
                    "dateUtc": "2015-08-06T06:40:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:40:00.000",
                    "dateUtc": "2015-08-06T06:40:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T08:55:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T08:55:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "KL",
                    "flightNumber": "2867",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 135
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "11"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970108,
            "carrierFsCode": "D9",
            "flightNumber": "5370",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "MRV",
            "departureDate": {
                "dateLocal": "2015-08-06T10:50:00.000",
                "dateUtc": "2015-08-06T07:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:15:00.000",
                "dateUtc": "2015-08-06T10:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:15:00.000",
                    "dateUtc": "2015-08-06T10:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:15:00.000",
                    "dateUtc": "2015-08-06T10:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:15:00.000",
                    "dateUtc": "2015-08-06T10:15:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "SU",
                    "flightNumber": "5370",
                    "relationship": "S"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 145
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "15"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970113,
            "carrierFsCode": "SU",
            "flightNumber": "1830",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "MSQ",
            "departureDate": {
                "dateLocal": "2015-08-06T08:35:00.000",
                "dateUtc": "2015-08-06T05:35:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:00:00.000",
                "dateUtc": "2015-08-06T07:00:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:35:00.000",
                    "dateUtc": "2015-08-06T05:35:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:35:00.000",
                    "dateUtc": "2015-08-06T05:35:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:35:00.000",
                    "dateUtc": "2015-08-06T05:35:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:35:00.000",
                    "dateUtc": "2015-08-06T05:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:00:00.000",
                    "dateUtc": "2015-08-06T07:00:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 85
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "20",
                "arrivalGate": "5"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970119,
            "carrierFsCode": "SU",
            "flightNumber": "2322",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "MUC",
            "departureDate": {
                "dateLocal": "2015-08-06T09:35:00.000",
                "dateUtc": "2015-08-06T06:35:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:45:00.000",
                "dateUtc": "2015-08-06T09:45:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 190
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "7",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970122,
            "carrierFsCode": "SU",
            "flightNumber": "2410",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "MXP",
            "departureDate": {
                "dateLocal": "2015-08-06T08:35:00.000",
                "dateUtc": "2015-08-06T05:35:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:10:00.000",
                "dateUtc": "2015-08-06T09:10:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:35:00.000",
                    "dateUtc": "2015-08-06T05:35:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:35:00.000",
                    "dateUtc": "2015-08-06T05:35:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:35:00.000",
                    "dateUtc": "2015-08-06T05:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AZ",
                    "flightNumber": "7013",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 215
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "24",
                "arrivalTerminal": "1",
                "baggage": "10"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970124,
            "carrierFsCode": "SU",
            "flightNumber": "2612",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "MXP",
            "departureDate": {
                "dateLocal": "2015-08-06T11:10:00.000",
                "dateUtc": "2015-08-06T08:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:45:00.000",
                "dateUtc": "2015-08-06T11:45:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:45:00.000",
                    "dateUtc": "2015-08-06T11:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:45:00.000",
                    "dateUtc": "2015-08-06T11:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:45:00.000",
                    "dateUtc": "2015-08-06T11:45:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AZ",
                    "flightNumber": "7011",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 215
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "28",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970129,
            "carrierFsCode": "SU",
            "flightNumber": "2470",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "NCE",
            "departureDate": {
                "dateLocal": "2015-08-06T10:15:00.000",
                "dateUtc": "2015-08-06T07:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:15:00.000",
                "dateUtc": "2015-08-06T11:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:15:00.000",
                    "dateUtc": "2015-08-06T11:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:15:00.000",
                    "dateUtc": "2015-08-06T11:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:15:00.000",
                    "dateUtc": "2015-08-06T11:15:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 240
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "33",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970130,
            "carrierFsCode": "SU",
            "flightNumber": "1470",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "NJC",
            "departureDate": {
                "dateLocal": "2015-08-06T11:20:00.000",
                "dateUtc": "2015-08-06T08:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T16:40:00.000",
                "dateUtc": "2015-08-06T11:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:20:00.000",
                    "dateUtc": "2015-08-06T08:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T16:40:00.000",
                    "dateUtc": "2015-08-06T11:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:20:00.000",
                    "dateUtc": "2015-08-06T08:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:20:00.000",
                    "dateUtc": "2015-08-06T08:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T16:40:00.000",
                    "dateUtc": "2015-08-06T11:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T16:40:00.000",
                    "dateUtc": "2015-08-06T11:40:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 200
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "11"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580970137,
            "carrierFsCode": "SU",
            "flightNumber": "1520",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "NUX",
            "departureDate": {
                "dateLocal": "2015-08-06T09:15:00.000",
                "dateUtc": "2015-08-06T06:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T14:40:00.000",
                "dateUtc": "2015-08-06T09:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T14:40:00.000",
                    "dateUtc": "2015-08-06T09:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T14:40:00.000",
                    "dateUtc": "2015-08-06T09:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T14:40:00.000",
                    "dateUtc": "2015-08-06T09:40:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 205
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "16"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580970146,
            "carrierFsCode": "SU",
            "flightNumber": "2174",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "OSL",
            "departureDate": {
                "dateLocal": "2015-08-06T10:30:00.000",
                "dateUtc": "2015-08-06T07:30:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:10:00.000",
                "dateUtc": "2015-08-06T10:10:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T10:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:30:00.000",
                    "dateUtc": "2015-08-06T07:30:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T10:10:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T10:10:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "FI",
                    "flightNumber": "7201",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 160
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "41"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970147,
            "carrierFsCode": "SU",
            "flightNumber": "2034",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "OTP",
            "departureDate": {
                "dateLocal": "2015-08-06T11:05:00.000",
                "dateUtc": "2015-08-06T08:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:45:00.000",
                "dateUtc": "2015-08-06T10:45:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:05:00.000",
                    "dateUtc": "2015-08-06T08:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:45:00.000",
                    "dateUtc": "2015-08-06T10:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:05:00.000",
                    "dateUtc": "2015-08-06T08:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:05:00.000",
                    "dateUtc": "2015-08-06T08:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:45:00.000",
                    "dateUtc": "2015-08-06T10:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:45:00.000",
                    "dateUtc": "2015-08-06T10:45:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "RO",
                    "flightNumber": "9202",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 160
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "36"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "SU9"
            }
        },
        {
            "flightId": 580970150,
            "carrierFsCode": "SU",
            "flightNumber": "1460",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "OVB",
            "departureDate": {
                "dateLocal": "2015-08-06T09:15:00.000",
                "dateUtc": "2015-08-06T06:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T16:15:00.000",
                "dateUtc": "2015-08-06T10:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T16:15:00.000",
                    "dateUtc": "2015-08-06T10:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T16:15:00.000",
                    "dateUtc": "2015-08-06T10:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T16:15:00.000",
                    "dateUtc": "2015-08-06T10:15:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4914",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3225",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 240
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "3",
                "arrivalTerminal": "A"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970156,
            "carrierFsCode": "SU",
            "flightNumber": "200",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "PEK",
            "departureDate": {
                "dateLocal": "2015-08-06T12:25:00.000",
                "dateUtc": "2015-08-06T09:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-07T01:00:00.000",
                "dateUtc": "2015-08-06T17:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-07T01:00:00.000",
                    "dateUtc": "2015-08-06T17:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T09:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-07T01:00:00.000",
                    "dateUtc": "2015-08-06T17:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-07T01:00:00.000",
                    "dateUtc": "2015-08-06T17:00:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 455
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "50",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "333"
            }
        },
        {
            "flightId": 580970165,
            "carrierFsCode": "SU",
            "flightNumber": "2012",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "PRG",
            "departureDate": {
                "dateLocal": "2015-08-06T10:20:00.000",
                "dateUtc": "2015-08-06T07:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:05:00.000",
                "dateUtc": "2015-08-06T10:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:05:00.000",
                    "dateUtc": "2015-08-06T10:05:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "OK",
                    "flightNumber": "4903",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 165
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "42",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970171,
            "carrierFsCode": "SU",
            "flightNumber": "206",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "PVG",
            "departureDate": {
                "dateLocal": "2015-08-06T09:20:00.000",
                "dateUtc": "2015-08-06T06:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T23:15:00.000",
                "dateUtc": "2015-08-06T15:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T23:15:00.000",
                    "dateUtc": "2015-08-06T15:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T23:15:00.000",
                    "dateUtc": "2015-08-06T15:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T22:41:00.000",
                    "dateUtc": "2015-08-06T14:41:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "MU",
                    "flightNumber": "8153",
                    "relationship": "L"
                }
            ],
            "delays": {
                "departureGateDelayMinutes": 60
            },
            "flightDurations": {
                "scheduledBlockMinutes": 535
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "50",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "333"
            }
        },
        {
            "flightId": 580970169,
            "carrierFsCode": "RU",
            "flightNumber": "419",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "PVG",
            "departureDate": {
                "dateLocal": "2015-08-06T10:25:00.000",
                "dateUtc": "2015-08-06T07:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-07T00:05:00.000",
                "dateUtc": "2015-08-06T16:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-07T00:05:00.000",
                    "dateUtc": "2015-08-06T16:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-07T00:05:00.000",
                    "dateUtc": "2015-08-06T16:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T23:12:00.000",
                    "dateUtc": "2015-08-06T15:12:00.000Z"
                }
            },
            "delays": {
                "departureGateDelayMinutes": 60
            },
            "flightDurations": {
                "scheduledBlockMinutes": 520
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74N"
            }
        },
        {
            "flightId": 580970168,
            "carrierFsCode": "RU",
            "flightNumber": "467",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "PVG",
            "departureDate": {
                "dateLocal": "2015-08-06T11:25:00.000",
                "dateUtc": "2015-08-06T08:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-07T01:05:00.000",
                "dateUtc": "2015-08-06T17:05:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-07T01:05:00.000",
                    "dateUtc": "2015-08-06T17:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-07T01:05:00.000",
                    "dateUtc": "2015-08-06T17:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-07T01:05:00.000",
                    "dateUtc": "2015-08-06T17:05:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 520
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74Y"
            }
        },
        {
            "flightId": 580970170,
            "carrierFsCode": "RU",
            "flightNumber": "497",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "PVG",
            "departureDate": {
                "dateLocal": "2015-08-06T12:20:00.000",
                "dateUtc": "2015-08-06T09:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-07T02:00:00.000",
                "dateUtc": "2015-08-06T18:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "F",
                "serviceClasses": "Y",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T12:20:00.000",
                    "dateUtc": "2015-08-06T09:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-07T02:00:00.000",
                    "dateUtc": "2015-08-06T18:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T12:20:00.000",
                    "dateUtc": "2015-08-06T09:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T12:20:00.000",
                    "dateUtc": "2015-08-06T09:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-07T02:00:00.000",
                    "dateUtc": "2015-08-06T18:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-07T02:00:00.000",
                    "dateUtc": "2015-08-06T18:00:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 520
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "74N"
            }
        },
        {
            "flightId": 580970179,
            "carrierFsCode": "SU",
            "flightNumber": "2682",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "RIX",
            "departureDate": {
                "dateLocal": "2015-08-06T09:20:00.000",
                "dateUtc": "2015-08-06T06:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:55:00.000",
                "dateUtc": "2015-08-06T07:55:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:55:00.000",
                    "dateUtc": "2015-08-06T07:55:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:20:00.000",
                    "dateUtc": "2015-08-06T06:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:55:00.000",
                    "dateUtc": "2015-08-06T07:55:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:55:00.000",
                    "dateUtc": "2015-08-06T07:55:00.000Z"
                },
                "estimatedRunwayArrival": {
                    "dateLocal": "2015-08-06T10:55:00.000",
                    "dateUtc": "2015-08-06T07:55:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "BT",
                    "flightNumber": "7425",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 95
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "27"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970175,
            "carrierFsCode": "BT",
            "flightNumber": "425",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "RIX",
            "departureDate": {
                "dateLocal": "2015-08-06T10:25:00.000",
                "dateUtc": "2015-08-06T07:25:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:10:00.000",
                "dateUtc": "2015-08-06T09:10:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:25:00.000",
                    "dateUtc": "2015-08-06T07:25:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                },
                "estimatedRunwayArrival": {
                    "dateLocal": "2015-08-06T12:10:00.000",
                    "dateUtc": "2015-08-06T09:10:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "SU",
                    "flightNumber": "3680",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 105
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "36"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73C"
            }
        },
        {
            "flightId": 580970182,
            "carrierFsCode": "D9",
            "flightNumber": "5304",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "ROV",
            "departureDate": {
                "dateLocal": "2015-08-06T09:05:00.000",
                "dateUtc": "2015-08-06T06:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:00:00.000",
                "dateUtc": "2015-08-06T08:00:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:00:00.000",
                    "dateUtc": "2015-08-06T08:00:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:00:00.000",
                    "dateUtc": "2015-08-06T08:00:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:00:00.000",
                    "dateUtc": "2015-08-06T08:00:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "SU",
                    "flightNumber": "5304",
                    "relationship": "S"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 115
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "19"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970188,
            "carrierFsCode": "SU",
            "flightNumber": "1620",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "SIP",
            "departureDate": {
                "dateLocal": "2015-08-06T08:10:00.000",
                "dateUtc": "2015-08-06T05:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:50:00.000",
                "dateUtc": "2015-08-06T07:50:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:10:00.000",
                    "dateUtc": "2015-08-06T05:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:10:00.000",
                    "dateUtc": "2015-08-06T05:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:26:00.000",
                    "dateUtc": "2015-08-06T05:26:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:26:00.000",
                    "dateUtc": "2015-08-06T05:26:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:27:00.000",
                    "dateUtc": "2015-08-06T05:27:00.000Z"
                },
                "actualRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:27:00.000",
                    "dateUtc": "2015-08-06T05:27:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:07:00.000",
                    "dateUtc": "2015-08-06T08:07:00.000Z"
                }
            },
            "delays": {
                "departureGateDelayMinutes": 16,
                "arrivalGateDelayMinutes": 17
            },
            "flightDurations": {
                "scheduledBlockMinutes": 160,
                "taxiOutMinutes": 1
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "11",
                "arrivalTerminal": "A"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580970193,
            "carrierFsCode": "SU",
            "flightNumber": "1622",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "SIP",
            "departureDate": {
                "dateLocal": "2015-08-06T09:00:00.000",
                "dateUtc": "2015-08-06T06:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:40:00.000",
                "dateUtc": "2015-08-06T08:40:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:00:00.000",
                    "dateUtc": "2015-08-06T06:00:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 160
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "1",
                "arrivalTerminal": "A"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "77W",
                "actualEquipmentIataCode": "77W"
            }
        },
        {
            "flightId": 580970199,
            "carrierFsCode": "SU",
            "flightNumber": "2060",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "SOF",
            "departureDate": {
                "dateLocal": "2015-08-06T08:20:00.000",
                "dateUtc": "2015-08-06T05:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:30:00.000",
                "dateUtc": "2015-08-06T08:30:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:20:00.000",
                    "dateUtc": "2015-08-06T05:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:20:00.000",
                    "dateUtc": "2015-08-06T05:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:17:00.000",
                    "dateUtc": "2015-08-06T05:17:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:17:00.000",
                    "dateUtc": "2015-08-06T05:17:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:30:00.000",
                    "dateUtc": "2015-08-06T08:30:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "FB",
                    "flightNumber": "1364",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 190
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "54",
                "arrivalTerminal": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "SU9"
            }
        },
        {
            "flightId": 580970201,
            "carrierFsCode": "SU",
            "flightNumber": "2336",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "STR",
            "departureDate": {
                "dateLocal": "2015-08-06T11:10:00.000",
                "dateUtc": "2015-08-06T08:10:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:30:00.000",
                "dateUtc": "2015-08-06T11:30:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:30:00.000",
                    "dateUtc": "2015-08-06T11:30:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:30:00.000",
                    "dateUtc": "2015-08-06T11:30:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:30:00.000",
                    "dateUtc": "2015-08-06T11:30:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 200
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "5",
                "arrivalTerminal": "1"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970208,
            "carrierFsCode": "SU",
            "flightNumber": "1400",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "SVX",
            "departureDate": {
                "dateLocal": "2015-08-06T08:50:00.000",
                "dateUtc": "2015-08-06T05:50:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:10:00.000",
                "dateUtc": "2015-08-06T08:10:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:50:00.000",
                    "dateUtc": "2015-08-06T05:50:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:50:00.000",
                    "dateUtc": "2015-08-06T05:50:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:50:00.000",
                    "dateUtc": "2015-08-06T05:50:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:10:00.000",
                    "dateUtc": "2015-08-06T08:10:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4428",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3196",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 140
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "13"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970204,
            "carrierFsCode": "SU",
            "flightNumber": "1402",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "SVX",
            "departureDate": {
                "dateLocal": "2015-08-06T11:55:00.000",
                "dateUtc": "2015-08-06T08:55:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T16:15:00.000",
                "dateUtc": "2015-08-06T11:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T08:55:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T16:15:00.000",
                    "dateUtc": "2015-08-06T11:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T08:55:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:55:00.000",
                    "dateUtc": "2015-08-06T08:55:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T16:15:00.000",
                    "dateUtc": "2015-08-06T11:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T16:15:00.000",
                    "dateUtc": "2015-08-06T11:15:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4896",
                    "relationship": "L"
                },
                {
                    "fsCode": "DL",
                    "flightNumber": "8184",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3216",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 140
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "12"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "73H"
            }
        },
        {
            "flightId": 580970213,
            "carrierFsCode": "SU",
            "flightNumber": "2318",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "SXF",
            "departureDate": {
                "dateLocal": "2015-08-06T11:40:00.000",
                "dateUtc": "2015-08-06T08:40:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:20:00.000",
                "dateUtc": "2015-08-06T11:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:20:00.000",
                    "dateUtc": "2015-08-06T11:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T11:40:00.000",
                    "dateUtc": "2015-08-06T08:40:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:20:00.000",
                    "dateUtc": "2015-08-06T11:20:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:20:00.000",
                    "dateUtc": "2015-08-06T11:20:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 160
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "31"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970222,
            "carrierFsCode": "SU",
            "flightNumber": "1500",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "TJM",
            "departureDate": {
                "dateLocal": "2015-08-06T08:40:00.000",
                "dateUtc": "2015-08-06T05:40:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:20:00.000",
                "dateUtc": "2015-08-06T08:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:40:00.000",
                    "dateUtc": "2015-08-06T05:40:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:20:00.000",
                    "dateUtc": "2015-08-06T08:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:40:00.000",
                    "dateUtc": "2015-08-06T05:40:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:40:00.000",
                    "dateUtc": "2015-08-06T05:40:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:20:00.000",
                    "dateUtc": "2015-08-06T08:20:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:20:00.000",
                    "dateUtc": "2015-08-06T08:20:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4852",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "2885",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 160
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "14"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970225,
            "carrierFsCode": "SU",
            "flightNumber": "2106",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "TLL",
            "departureDate": {
                "dateLocal": "2015-08-06T09:05:00.000",
                "dateUtc": "2015-08-06T06:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:45:00.000",
                "dateUtc": "2015-08-06T07:45:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:05:00.000",
                    "dateUtc": "2015-08-06T06:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 100
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "45"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970226,
            "carrierFsCode": "SU",
            "flightNumber": "502",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "TLV",
            "departureDate": {
                "dateLocal": "2015-08-06T09:30:00.000",
                "dateUtc": "2015-08-06T06:30:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T13:35:00.000",
                "dateUtc": "2015-08-06T10:35:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T13:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T13:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T13:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 245
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "22",
                "arrivalTerminal": "3"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "77W"
            }
        },
        {
            "flightId": 580970229,
            "carrierFsCode": "SU",
            "flightNumber": "1534",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "TOF",
            "departureDate": {
                "dateLocal": "2015-08-06T08:00:00.000",
                "dateUtc": "2015-08-06T05:00:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T15:05:00.000",
                "dateUtc": "2015-08-06T09:05:00.000Z"
            },
            "status": "A",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:00:00.000",
                    "dateUtc": "2015-08-06T05:00:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T09:05:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:00:00.000",
                    "dateUtc": "2015-08-06T05:00:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:16:00.000",
                    "dateUtc": "2015-08-06T05:16:00.000Z"
                },
                "actualGateDeparture": {
                    "dateLocal": "2015-08-06T08:16:00.000",
                    "dateUtc": "2015-08-06T05:16:00.000Z"
                },
                "estimatedRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:17:00.000",
                    "dateUtc": "2015-08-06T05:17:00.000Z"
                },
                "actualRunwayDeparture": {
                    "dateLocal": "2015-08-06T08:17:00.000",
                    "dateUtc": "2015-08-06T05:17:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T15:05:00.000",
                    "dateUtc": "2015-08-06T09:05:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T15:21:00.000",
                    "dateUtc": "2015-08-06T09:21:00.000Z"
                }
            },
            "delays": {
                "departureGateDelayMinutes": 16,
                "arrivalGateDelayMinutes": 16
            },
            "flightDurations": {
                "scheduledBlockMinutes": 245,
                "taxiOutMinutes": 1
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970234,
            "carrierFsCode": "SU",
            "flightNumber": "1260",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "UFA",
            "departureDate": {
                "dateLocal": "2015-08-06T08:55:00.000",
                "dateUtc": "2015-08-06T05:55:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:50:00.000",
                "dateUtc": "2015-08-06T07:50:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:55:00.000",
                    "dateUtc": "2015-08-06T05:55:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:55:00.000",
                    "dateUtc": "2015-08-06T05:55:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:55:00.000",
                    "dateUtc": "2015-08-06T05:55:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:50:00.000",
                    "dateUtc": "2015-08-06T07:50:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "KL",
                    "flightNumber": "2871",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 115
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "18"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970240,
            "carrierFsCode": "SU",
            "flightNumber": "2596",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "VCE",
            "departureDate": {
                "dateLocal": "2015-08-06T09:30:00.000",
                "dateUtc": "2015-08-06T06:30:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:45:00.000",
                "dateUtc": "2015-08-06T09:45:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:45:00.000",
                    "dateUtc": "2015-08-06T09:45:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AZ",
                    "flightNumber": "7181",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 195
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "38"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "321"
            }
        },
        {
            "flightId": 580970243,
            "carrierFsCode": "SU",
            "flightNumber": "2184",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "VIE",
            "departureDate": {
                "dateLocal": "2015-08-06T09:30:00.000",
                "dateUtc": "2015-08-06T06:30:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:15:00.000",
                "dateUtc": "2015-08-06T09:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:30:00.000",
                    "dateUtc": "2015-08-06T06:30:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:15:00.000",
                    "dateUtc": "2015-08-06T09:15:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 165
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "48"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970245,
            "carrierFsCode": "SU",
            "flightNumber": "2104",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "VNO",
            "departureDate": {
                "dateLocal": "2015-08-06T08:45:00.000",
                "dateUtc": "2015-08-06T05:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:15:00.000",
                "dateUtc": "2015-08-06T07:15:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T08:45:00.000",
                    "dateUtc": "2015-08-06T05:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:15:00.000",
                    "dateUtc": "2015-08-06T07:15:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 90
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "46"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "SU9"
            }
        },
        {
            "flightId": 580970246,
            "carrierFsCode": "SU",
            "flightNumber": "1758",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "VOG",
            "departureDate": {
                "dateLocal": "2015-08-06T09:35:00.000",
                "dateUtc": "2015-08-06T06:35:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:25:00.000",
                "dateUtc": "2015-08-06T08:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:35:00.000",
                    "dateUtc": "2015-08-06T06:35:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:25:00.000",
                    "dateUtc": "2015-08-06T08:25:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "AF",
                    "flightNumber": "4420",
                    "relationship": "L"
                },
                {
                    "fsCode": "KL",
                    "flightNumber": "3270",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 110
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "2"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970251,
            "carrierFsCode": "SU",
            "flightNumber": "1350",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "VOZ",
            "departureDate": {
                "dateLocal": "2015-08-06T09:15:00.000",
                "dateUtc": "2015-08-06T06:15:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T10:20:00.000",
                "dateUtc": "2015-08-06T07:20:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RFJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T09:15:00.000",
                    "dateUtc": "2015-08-06T06:15:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 65
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "21"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "SU9"
            }
        },
        {
            "flightId": 580970256,
            "carrierFsCode": "SU",
            "flightNumber": "2000",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "WAW",
            "departureDate": {
                "dateLocal": "2015-08-06T10:45:00.000",
                "dateUtc": "2015-08-06T07:45:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T11:50:00.000",
                "dateUtc": "2015-08-06T09:50:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T11:50:00.000",
                    "dateUtc": "2015-08-06T09:50:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:45:00.000",
                    "dateUtc": "2015-08-06T07:45:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T11:50:00.000",
                    "dateUtc": "2015-08-06T09:50:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T11:50:00.000",
                    "dateUtc": "2015-08-06T09:50:00.000Z"
                }
            },
            "codeshares": [
                {
                    "fsCode": "LO",
                    "flightNumber": "5678",
                    "relationship": "L"
                }
            ],
            "flightDurations": {
                "scheduledBlockMinutes": 125
            },
            "airportResources": {
                "departureTerminal": "D",
                "departureGate": "22"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        },
        {
            "flightId": 580970260,
            "carrierFsCode": "SU",
            "flightNumber": "2040",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "ZAG",
            "departureDate": {
                "dateLocal": "2015-08-06T10:20:00.000",
                "dateUtc": "2015-08-06T07:20:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:25:00.000",
                "dateUtc": "2015-08-06T10:25:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T10:25:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:20:00.000",
                    "dateUtc": "2015-08-06T07:20:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T10:25:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:25:00.000",
                    "dateUtc": "2015-08-06T10:25:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 185
            },
            "airportResources": {
                "departureTerminal": "E",
                "departureGate": "34"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "319"
            }
        },
        {
            "flightId": 580970262,
            "carrierFsCode": "SU",
            "flightNumber": "2390",
            "departureAirportFsCode": "SVO",
            "arrivalAirportFsCode": "ZRH",
            "departureDate": {
                "dateLocal": "2015-08-06T10:05:00.000",
                "dateUtc": "2015-08-06T07:05:00.000Z"
            },
            "arrivalDate": {
                "dateLocal": "2015-08-06T12:35:00.000",
                "dateUtc": "2015-08-06T10:35:00.000Z"
            },
            "status": "S",
            "schedule": {
                "flightType": "J",
                "serviceClasses": "RJY",
                "restrictions": ""
            },
            "operationalTimes": {
                "publishedDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "publishedArrival": {
                    "dateLocal": "2015-08-06T12:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                },
                "scheduledGateDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "estimatedGateDeparture": {
                    "dateLocal": "2015-08-06T10:05:00.000",
                    "dateUtc": "2015-08-06T07:05:00.000Z"
                },
                "scheduledGateArrival": {
                    "dateLocal": "2015-08-06T12:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                },
                "estimatedGateArrival": {
                    "dateLocal": "2015-08-06T12:35:00.000",
                    "dateUtc": "2015-08-06T10:35:00.000Z"
                }
            },
            "flightDurations": {
                "scheduledBlockMinutes": 210
            },
            "airportResources": {
                "departureTerminal": "F",
                "departureGate": "56"
            },
            "flightEquipment": {
                "scheduledEquipmentIataCode": "320"
            }
        }
    ],
    "airport": "SVO",
    "mode": "dep"
}

/* end: ../../common.blocks/api/__airport-status/_data/api__airport-status_data.js */
/* begin: ../../libs/bem-components/common.blocks/radio/_type/radio_type_button.js */
/**
 * @module radio
 */

modules.define('radio', ['button'], function(provide, _, Radio) {

/**
 * @exports
 * @class radio
 * @bem
 */
provide(Radio.decl({ modName : 'type', modVal : 'button' }, /** @lends radio.prototype */{
    onSetMod : {
        'js' : {
            'inited' : function() {
                this.__base.apply(this, arguments);
                this._button = this.findBlockInside('button')
                    .on(
                        { modName : 'checked', modVal : '*' },
                        proxyModFromButton,
                        this)
                    .on(
                        { modName : 'focused', modVal : '*' },
                        proxyModFromButton,
                        this);
            }
        },

        'checked' : proxyModToButton,
        'disabled' : proxyModToButton,
        'focused' : function(modName, modVal) {
            proxyModToButton.call(this, modName, modVal, false);
        }
    }
}, /** @lends radio */{
    live : function() {
        this.liveInitOnBlockInsideEvent({ modName : 'js', modVal : 'inited' }, 'button');
        return this.__base.apply(this, arguments);
    }
}));

function proxyModToButton(modName, modVal, callBase) {
    callBase !== false && this.__base.apply(this, arguments);
    this._button.setMod(modName, modVal);
}

function proxyModFromButton(_, data) {
    this.setMod(data.modName, data.modVal);
}

});

/* end: ../../libs/bem-components/common.blocks/radio/_type/radio_type_button.js */
/* begin: ../../libs/bem-components/design/common.blocks/popup/_theme/popup_theme_islands.js */
modules.define('popup', ['objects'], function(provide, objects, Popup) {

provide(Popup.decl({ modName : 'theme', modVal : 'islands' }, {
    getDefaultParams : function() {
        return objects.extend(
            this.__base(),
            {
                mainOffset : 5,
                viewportOffset : 10
            });
    }
}));

});

/* end: ../../libs/bem-components/design/common.blocks/popup/_theme/popup_theme_islands.js */
/* begin: ../../libs/bem-components/common.blocks/popup/_target/popup_target_position.js */
/**
 * @module popup
 */

modules.define(
    'popup',
    function(provide, Popup) {

/**
 * @exports
 * @class popup
 * @bem
 */
provide(Popup.decl({ modName : 'target', modVal : 'position' }, /** @lends popup.prototype */{
    beforeSetMod : {
        'visible' : {
            'true' : function() {
                if(!this._position)
                    throw Error('Can\'t show popup without position');
            }
        }
    },

    onSetMod : {
        'js' : {
            'inited' : function() {
                this.__base.apply(this, arguments);
                this._position = null;
            }
        }
    },

    /**
     * Sets position
     * @param {Number} left x-coordinate
     * @param {Number} top y-coordinate
     * @returns {popup} this
     */
    setPosition : function(left, top) {
        this._position = { left : left, top : top };
        return this.redraw();
    },

    /**
     * @override
     */
    _calcTargetDimensions : function() {
        var pos = this._position;

        return {
            left : pos.left,
            top : pos.top,
            width : 0,
            height : 0
        };
    }
}));

});

/* end: ../../libs/bem-components/common.blocks/popup/_target/popup_target_position.js */
/* begin: ../../common.blocks/popup/_main/popup_main_row.js */
modules.define('popup', ['i-bem__dom', 'jquery'], function (provide, BEMDOM, $, Popup) {

        provide(
            Popup.decl({
                    modName: 'main',
                    modVal: 'row'
                }, {
                    onSetMod: {
                        'js': {
                            'inited': function () {
                                this.__base.apply(this, arguments);

                                this.setMod('target', 'position');
                                this.setPosition(0, 0);
                            }
                        },
                        'visible': {
                            'true': function () {
                                this.__base.apply(this, arguments);

                                this.bindTo('click', function (e) {
                                    //Do nothing if popup content clicked.
                                    if (!$(e.target).hasClass('popup_main_row')) {
                                        return;
                                    }
                                    //Close popup if it was clicked.
                                    this.setMod('visible', false);
                                });
                            },
                            '': function () {
                                this.__base.apply(this, arguments);

                                this.unbindFrom('click')
                            }
                        }
                    }
                }
            )
        );

    }
);

/* end: ../../common.blocks/popup/_main/popup_main_row.js */
/* begin: ../../common.blocks/grid/__cell/_format/grid__cell_format_airline.js */
modules.define('grid__cell_format_airline', ['i-bem__dom', 'jquery', 'bh'], function (provide, BEMDOM, $, bh) {

    provide(
        BEMDOM.decl(
            this.name, {
                onSetMod: {
                    'js': {
                        'inited': function () {

                            var block = this.findBlockOutside('grid');

                            if (block == null) {
                                return;
                            }

                            var popup = block.findBlockInside({block: 'popup', modName: 'target', modVal: 'anchor'});

                            this.domElem.bind('mouseenter', function () {

                                var airlineName = $(this).data('bem').grid__cell_format_airline.name;

                                popup.setMod('target', 'anchor');
                                popup.setAnchor($(this));
                                popup.setContent(bh.apply([
                                    {
                                        tag: 'span',
                                        content: airlineName
                                    }
                                ]));

                                popup.setMod('visible', true);
                            });

                            this.domElem.bind('mouseleave', function () {
                                popup.setMod('visible', false);
                            });
                        }
                    }
                }
            }
        )
    );
});

/* end: ../../common.blocks/grid/__cell/_format/grid__cell_format_airline.js */
/* begin: ../../common.blocks/controls/controls.js */
modules.define(
    'controls',
    ['i-bem__dom', 'jquery'],
    function (provide, BEMDOM, $) {
        provide(BEMDOM.decl(this.name, {
            onSetMod: {
                'js': {
                    'inited': function () {
                        var _self = this;
                        this.findBlocksInside('radio-group').forEach(function (block) {
                            block.on('change',
                                _self._onRadioChange,
                                _self);
                        });
                    }
                }
            },
            _onRadioChange: function () {
                var _self = this;
                this.emit('change', _self.getValues());
            },
            getValues: function () {
                var values = {
                    airport: this.findBlockInside({
                        block: 'radio-group',
                        modName: 'name',
                        modVal: 'airport'
                    }).getVal(),
                    mode: this.findBlockInside({
                        block: 'radio-group',
                        modName: 'name',
                        modVal: 'mode'
                    }).getVal()
                };
                return values;
            }
        }));
    }
);

/* end: ../../common.blocks/controls/controls.js */
/* begin: ../../common.blocks/grid/__row/_content/grid__row_content.js */
modules.define('grid__row_content', ['i-bem__dom', 'jquery', 'bh'], function (provide, BEMDOM, $, bh) {
    provide(
        BEMDOM.decl(
            this.name, {
                onSetMod: {
                    'js': {
                        'inited': function () {
                            var block = this.findBlockOutside('grid'),
                                popup = block.findBlockInside({block: 'popup'});
                            //Show popup with row data on row click.
                            this.domElem.bind('click', function () {
                                var rowData = $(this)
                                    .data('bem')
                                    .grid__row_content
                                    .data;

                                popup.setContent(bh.apply({
                                    block: 'popup',
                                    elem: 'content',
                                    mods: {main: 'row'},
                                    data: rowData
                                }));

                                popup.setMod('visible', true);
                            });
                        }
                    }
                }
            }
        )
    );
});

/* end: ../../common.blocks/grid/__row/_content/grid__row_content.js */