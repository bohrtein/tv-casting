(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // node_modules/@babel/runtime/helpers/interopRequireDefault.js
  var require_interopRequireDefault = __commonJS({
    "node_modules/@babel/runtime/helpers/interopRequireDefault.js"(exports, module) {
      function _interopRequireDefault(obj) {
        return obj && obj.__esModule ? obj : {
          "default": obj
        };
      }
      module.exports = _interopRequireDefault, module.exports.__esModule = true, module.exports["default"] = module.exports;
    }
  });

  // node_modules/@babel/runtime/helpers/typeof.js
  var require_typeof = __commonJS({
    "node_modules/@babel/runtime/helpers/typeof.js"(exports, module) {
      function _typeof(o) {
        "@babel/helpers - typeof";
        return module.exports = _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, module.exports.__esModule = true, module.exports["default"] = module.exports, _typeof(o);
      }
      module.exports = _typeof, module.exports.__esModule = true, module.exports["default"] = module.exports;
    }
  });

  // node_modules/@babel/runtime/helpers/regeneratorRuntime.js
  var require_regeneratorRuntime = __commonJS({
    "node_modules/@babel/runtime/helpers/regeneratorRuntime.js"(exports, module) {
      var _typeof = require_typeof()["default"];
      function _regeneratorRuntime() {
        "use strict";
        module.exports = _regeneratorRuntime = function _regeneratorRuntime2() {
          return e;
        }, module.exports.__esModule = true, module.exports["default"] = module.exports;
        var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function(t2, e2, r2) {
          t2[e2] = r2.value;
        }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag";
        function define(t2, e2, r2) {
          return Object.defineProperty(t2, e2, {
            value: r2,
            enumerable: true,
            configurable: true,
            writable: true
          }), t2[e2];
        }
        try {
          define({}, "");
        } catch (t2) {
          define = function define2(t3, e2, r2) {
            return t3[e2] = r2;
          };
        }
        function wrap(t2, e2, r2, n2) {
          var i2 = e2 && e2.prototype instanceof Generator ? e2 : Generator, a2 = Object.create(i2.prototype), c2 = new Context(n2 || []);
          return o(a2, "_invoke", {
            value: makeInvokeMethod(t2, r2, c2)
          }), a2;
        }
        function tryCatch(t2, e2, r2) {
          try {
            return {
              type: "normal",
              arg: t2.call(e2, r2)
            };
          } catch (t3) {
            return {
              type: "throw",
              arg: t3
            };
          }
        }
        e.wrap = wrap;
        var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {};
        function Generator() {
        }
        function GeneratorFunction() {
        }
        function GeneratorFunctionPrototype() {
        }
        var p = {};
        define(p, a, function() {
          return this;
        });
        var d = Object.getPrototypeOf, v = d && d(d(values([])));
        v && v !== r && n.call(v, a) && (p = v);
        var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);
        function defineIteratorMethods(t2) {
          ["next", "throw", "return"].forEach(function(e2) {
            define(t2, e2, function(t3) {
              return this._invoke(e2, t3);
            });
          });
        }
        function AsyncIterator(t2, e2) {
          function invoke(r3, o2, i2, a2) {
            var c2 = tryCatch(t2[r3], t2, o2);
            if ("throw" !== c2.type) {
              var u2 = c2.arg, h2 = u2.value;
              return h2 && "object" == _typeof(h2) && n.call(h2, "__await") ? e2.resolve(h2.__await).then(function(t3) {
                invoke("next", t3, i2, a2);
              }, function(t3) {
                invoke("throw", t3, i2, a2);
              }) : e2.resolve(h2).then(function(t3) {
                u2.value = t3, i2(u2);
              }, function(t3) {
                return invoke("throw", t3, i2, a2);
              });
            }
            a2(c2.arg);
          }
          var r2;
          o(this, "_invoke", {
            value: function value(t3, n2) {
              function callInvokeWithMethodAndArg() {
                return new e2(function(e3, r3) {
                  invoke(t3, n2, e3, r3);
                });
              }
              return r2 = r2 ? r2.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg();
            }
          });
        }
        function makeInvokeMethod(e2, r2, n2) {
          var o2 = h;
          return function(i2, a2) {
            if (o2 === f) throw Error("Generator is already running");
            if (o2 === s) {
              if ("throw" === i2) throw a2;
              return {
                value: t,
                done: true
              };
            }
            for (n2.method = i2, n2.arg = a2; ; ) {
              var c2 = n2.delegate;
              if (c2) {
                var u2 = maybeInvokeDelegate(c2, n2);
                if (u2) {
                  if (u2 === y) continue;
                  return u2;
                }
              }
              if ("next" === n2.method) n2.sent = n2._sent = n2.arg;
              else if ("throw" === n2.method) {
                if (o2 === h) throw o2 = s, n2.arg;
                n2.dispatchException(n2.arg);
              } else "return" === n2.method && n2.abrupt("return", n2.arg);
              o2 = f;
              var p2 = tryCatch(e2, r2, n2);
              if ("normal" === p2.type) {
                if (o2 = n2.done ? s : l, p2.arg === y) continue;
                return {
                  value: p2.arg,
                  done: n2.done
                };
              }
              "throw" === p2.type && (o2 = s, n2.method = "throw", n2.arg = p2.arg);
            }
          };
        }
        function maybeInvokeDelegate(e2, r2) {
          var n2 = r2.method, o2 = e2.iterator[n2];
          if (o2 === t) return r2.delegate = null, "throw" === n2 && e2.iterator["return"] && (r2.method = "return", r2.arg = t, maybeInvokeDelegate(e2, r2), "throw" === r2.method) || "return" !== n2 && (r2.method = "throw", r2.arg = new TypeError("The iterator does not provide a '" + n2 + "' method")), y;
          var i2 = tryCatch(o2, e2.iterator, r2.arg);
          if ("throw" === i2.type) return r2.method = "throw", r2.arg = i2.arg, r2.delegate = null, y;
          var a2 = i2.arg;
          return a2 ? a2.done ? (r2[e2.resultName] = a2.value, r2.next = e2.nextLoc, "return" !== r2.method && (r2.method = "next", r2.arg = t), r2.delegate = null, y) : a2 : (r2.method = "throw", r2.arg = new TypeError("iterator result is not an object"), r2.delegate = null, y);
        }
        function pushTryEntry(t2) {
          var e2 = {
            tryLoc: t2[0]
          };
          1 in t2 && (e2.catchLoc = t2[1]), 2 in t2 && (e2.finallyLoc = t2[2], e2.afterLoc = t2[3]), this.tryEntries.push(e2);
        }
        function resetTryEntry(t2) {
          var e2 = t2.completion || {};
          e2.type = "normal", delete e2.arg, t2.completion = e2;
        }
        function Context(t2) {
          this.tryEntries = [{
            tryLoc: "root"
          }], t2.forEach(pushTryEntry, this), this.reset(true);
        }
        function values(e2) {
          if (e2 || "" === e2) {
            var r2 = e2[a];
            if (r2) return r2.call(e2);
            if ("function" == typeof e2.next) return e2;
            if (!isNaN(e2.length)) {
              var o2 = -1, i2 = function next() {
                for (; ++o2 < e2.length; ) if (n.call(e2, o2)) return next.value = e2[o2], next.done = false, next;
                return next.value = t, next.done = true, next;
              };
              return i2.next = i2;
            }
          }
          throw new TypeError(_typeof(e2) + " is not iterable");
        }
        return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", {
          value: GeneratorFunctionPrototype,
          configurable: true
        }), o(GeneratorFunctionPrototype, "constructor", {
          value: GeneratorFunction,
          configurable: true
        }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function(t2) {
          var e2 = "function" == typeof t2 && t2.constructor;
          return !!e2 && (e2 === GeneratorFunction || "GeneratorFunction" === (e2.displayName || e2.name));
        }, e.mark = function(t2) {
          return Object.setPrototypeOf ? Object.setPrototypeOf(t2, GeneratorFunctionPrototype) : (t2.__proto__ = GeneratorFunctionPrototype, define(t2, u, "GeneratorFunction")), t2.prototype = Object.create(g), t2;
        }, e.awrap = function(t2) {
          return {
            __await: t2
          };
        }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function() {
          return this;
        }), e.AsyncIterator = AsyncIterator, e.async = function(t2, r2, n2, o2, i2) {
          void 0 === i2 && (i2 = Promise);
          var a2 = new AsyncIterator(wrap(t2, r2, n2, o2), i2);
          return e.isGeneratorFunction(r2) ? a2 : a2.next().then(function(t3) {
            return t3.done ? t3.value : a2.next();
          });
        }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function() {
          return this;
        }), define(g, "toString", function() {
          return "[object Generator]";
        }), e.keys = function(t2) {
          var e2 = Object(t2), r2 = [];
          for (var n2 in e2) r2.push(n2);
          return r2.reverse(), function next() {
            for (; r2.length; ) {
              var t3 = r2.pop();
              if (t3 in e2) return next.value = t3, next.done = false, next;
            }
            return next.done = true, next;
          };
        }, e.values = values, Context.prototype = {
          constructor: Context,
          reset: function reset(e2) {
            if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = false, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e2) for (var r2 in this) "t" === r2.charAt(0) && n.call(this, r2) && !isNaN(+r2.slice(1)) && (this[r2] = t);
          },
          stop: function stop() {
            this.done = true;
            var t2 = this.tryEntries[0].completion;
            if ("throw" === t2.type) throw t2.arg;
            return this.rval;
          },
          dispatchException: function dispatchException(e2) {
            if (this.done) throw e2;
            var r2 = this;
            function handle(n2, o3) {
              return a2.type = "throw", a2.arg = e2, r2.next = n2, o3 && (r2.method = "next", r2.arg = t), !!o3;
            }
            for (var o2 = this.tryEntries.length - 1; o2 >= 0; --o2) {
              var i2 = this.tryEntries[o2], a2 = i2.completion;
              if ("root" === i2.tryLoc) return handle("end");
              if (i2.tryLoc <= this.prev) {
                var c2 = n.call(i2, "catchLoc"), u2 = n.call(i2, "finallyLoc");
                if (c2 && u2) {
                  if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
                  if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
                } else if (c2) {
                  if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
                } else {
                  if (!u2) throw Error("try statement without catch or finally");
                  if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
                }
              }
            }
          },
          abrupt: function abrupt(t2, e2) {
            for (var r2 = this.tryEntries.length - 1; r2 >= 0; --r2) {
              var o2 = this.tryEntries[r2];
              if (o2.tryLoc <= this.prev && n.call(o2, "finallyLoc") && this.prev < o2.finallyLoc) {
                var i2 = o2;
                break;
              }
            }
            i2 && ("break" === t2 || "continue" === t2) && i2.tryLoc <= e2 && e2 <= i2.finallyLoc && (i2 = null);
            var a2 = i2 ? i2.completion : {};
            return a2.type = t2, a2.arg = e2, i2 ? (this.method = "next", this.next = i2.finallyLoc, y) : this.complete(a2);
          },
          complete: function complete(t2, e2) {
            if ("throw" === t2.type) throw t2.arg;
            return "break" === t2.type || "continue" === t2.type ? this.next = t2.arg : "return" === t2.type ? (this.rval = this.arg = t2.arg, this.method = "return", this.next = "end") : "normal" === t2.type && e2 && (this.next = e2), y;
          },
          finish: function finish(t2) {
            for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
              var r2 = this.tryEntries[e2];
              if (r2.finallyLoc === t2) return this.complete(r2.completion, r2.afterLoc), resetTryEntry(r2), y;
            }
          },
          "catch": function _catch(t2) {
            for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
              var r2 = this.tryEntries[e2];
              if (r2.tryLoc === t2) {
                var n2 = r2.completion;
                if ("throw" === n2.type) {
                  var o2 = n2.arg;
                  resetTryEntry(r2);
                }
                return o2;
              }
            }
            throw Error("illegal catch attempt");
          },
          delegateYield: function delegateYield(e2, r2, n2) {
            return this.delegate = {
              iterator: values(e2),
              resultName: r2,
              nextLoc: n2
            }, "next" === this.method && (this.arg = t), y;
          }
        }, e;
      }
      module.exports = _regeneratorRuntime, module.exports.__esModule = true, module.exports["default"] = module.exports;
    }
  });

  // node_modules/@babel/runtime/regenerator/index.js
  var require_regenerator = __commonJS({
    "node_modules/@babel/runtime/regenerator/index.js"(exports, module) {
      var runtime = require_regeneratorRuntime()();
      module.exports = runtime;
      try {
        regeneratorRuntime = runtime;
      } catch (accidentalStrictMode) {
        if (typeof globalThis === "object") {
          globalThis.regeneratorRuntime = runtime;
        } else {
          Function("r", "regeneratorRuntime = r")(runtime);
        }
      }
    }
  });

  // node_modules/@babel/runtime/helpers/asyncToGenerator.js
  var require_asyncToGenerator = __commonJS({
    "node_modules/@babel/runtime/helpers/asyncToGenerator.js"(exports, module) {
      function asyncGeneratorStep(gen, resolve, reject, _next, _throw, key, arg) {
        try {
          var info = gen[key](arg);
          var value = info.value;
        } catch (error) {
          reject(error);
          return;
        }
        if (info.done) {
          resolve(value);
        } else {
          Promise.resolve(value).then(_next, _throw);
        }
      }
      function _asyncToGenerator(fn) {
        return function() {
          var self2 = this, args = arguments;
          return new Promise(function(resolve, reject) {
            var gen = fn.apply(self2, args);
            function _next(value) {
              asyncGeneratorStep(gen, resolve, reject, _next, _throw, "next", value);
            }
            function _throw(err) {
              asyncGeneratorStep(gen, resolve, reject, _next, _throw, "throw", err);
            }
            _next(void 0);
          });
        };
      }
      module.exports = _asyncToGenerator, module.exports.__esModule = true, module.exports["default"] = module.exports;
    }
  });

  // node_modules/@stremio/stremio-core-web/bridge.js
  var require_bridge = __commonJS({
    "node_modules/@stremio/stremio-core-web/bridge.js"(exports, module) {
      "use strict";
      var _interopRequireDefault = require_interopRequireDefault();
      var _regenerator = _interopRequireDefault(require_regenerator());
      var _asyncToGenerator2 = _interopRequireDefault(require_asyncToGenerator());
      function getId() {
        return Math.random().toString(32).slice(2);
      }
      function Bridge(scope, handler) {
        handler.addEventListener("message", /* @__PURE__ */ (function() {
          var _ref2 = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee(_ref) {
            var request, id, path, args, value, data, thisArg;
            return _regenerator["default"].wrap(function _callee$(_context) {
              while (1) switch (_context.prev = _context.next) {
                case 0:
                  request = _ref.data.request;
                  if (request) {
                    _context.next = 3;
                    break;
                  }
                  return _context.abrupt("return");
                case 3:
                  id = request.id, path = request.path, args = request.args;
                  _context.prev = 4;
                  value = path.reduce(function(value2, prop) {
                    return value2[prop];
                  }, scope);
                  if (!(typeof value === "function")) {
                    _context.next = 13;
                    break;
                  }
                  thisArg = path.slice(0, path.length - 1).reduce(function(value2, prop) {
                    return value2[prop];
                  }, scope);
                  _context.next = 10;
                  return value.apply(thisArg, args);
                case 10:
                  data = _context.sent;
                  _context.next = 16;
                  break;
                case 13:
                  _context.next = 15;
                  return value;
                case 15:
                  data = _context.sent;
                case 16:
                  handler.postMessage({
                    response: {
                      id,
                      result: {
                        data
                      }
                    }
                  });
                  _context.next = 22;
                  break;
                case 19:
                  _context.prev = 19;
                  _context.t0 = _context["catch"](4);
                  handler.postMessage({
                    response: {
                      id,
                      result: {
                        error: _context.t0
                      }
                    }
                  });
                case 22:
                case "end":
                  return _context.stop();
              }
            }, _callee, null, [[4, 19]]);
          }));
          return function(_x) {
            return _ref2.apply(this, arguments);
          };
        })());
        this.call = /* @__PURE__ */ (function() {
          var _ref3 = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee2(path, args) {
            var id;
            return _regenerator["default"].wrap(function _callee2$(_context2) {
              while (1) switch (_context2.prev = _context2.next) {
                case 0:
                  id = getId();
                  return _context2.abrupt("return", new Promise(function(resolve, reject) {
                    var onMessage = function onMessage2(_ref4) {
                      var response = _ref4.data.response;
                      if (!response || response.id !== id) return;
                      handler.removeEventListener("message", onMessage2);
                      if ("error" in response.result) {
                        reject(response.result.error);
                      } else {
                        resolve(response.result.data);
                      }
                    };
                    handler.addEventListener("message", onMessage);
                    handler.postMessage({
                      request: {
                        id,
                        path,
                        args
                      }
                    });
                  }));
                case 2:
                case "end":
                  return _context2.stop();
              }
            }, _callee2);
          }));
          return function(_x2, _x3) {
            return _ref3.apply(this, arguments);
          };
        })();
      }
      module.exports = Bridge;
    }
  });

  // node_modules/@stremio/stremio-core-web/stremio_core_web.js
  var require_stremio_core_web = __commonJS({
    "node_modules/@stremio/stremio-core-web/stremio_core_web.js"(exports, module) {
      "use strict";
      var _interopRequireDefault = require_interopRequireDefault();
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.analytics = analytics;
      exports.decode_stream = decode_stream;
      exports["default"] = __wbg_init;
      exports.dispatch = dispatch;
      exports.encode_stream = encode_stream;
      exports.get_state = get_state;
      exports.initSync = initSync;
      exports.initialize_runtime = initialize_runtime;
      exports.start = start;
      var _regenerator = _interopRequireDefault(require_regenerator());
      var _asyncToGenerator2 = _interopRequireDefault(require_asyncToGenerator());
      var _typeof2 = _interopRequireDefault(require_typeof());
      var importMeta = {
        url: new URL("/stremio_core_web.js", document.baseURI).href
      };
      function analytics(event, location_hash) {
        wasm.analytics(event, location_hash);
      }
      function decode_stream(stream) {
        var ret = wasm.decode_stream(stream);
        return ret;
      }
      function dispatch(action, field, location_hash) {
        var ret = wasm.dispatch(action, field, location_hash);
        if (ret[1]) {
          throw takeFromExternrefTable0(ret[0]);
        }
      }
      function encode_stream(stream) {
        var ret = wasm.encode_stream(stream);
        return ret;
      }
      function get_state(field) {
        var ret = wasm.get_state(field);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
      }
      function initialize_runtime(emit_to_ui) {
        var ret = wasm.initialize_runtime(emit_to_ui);
        return ret;
      }
      function start() {
        wasm.start();
      }
      function __wbg_get_imports() {
        var import0 = {
          __proto__: null,
          __wbg___wbindgen_debug_string_edece8177ad01481: function __wbg___wbindgen_debug_string_edece8177ad01481(arg0, arg1) {
            var ret = debugString(arg1);
            var ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
          },
          __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function __wbg___wbindgen_is_function_5cd60d5cf78b4eef(arg0) {
            var ret = typeof arg0 === "function";
            return ret;
          },
          __wbg___wbindgen_is_object_b4593df85baada48: function __wbg___wbindgen_is_object_b4593df85baada48(arg0) {
            var val = arg0;
            var ret = (0, _typeof2["default"])(val) === "object" && val !== null;
            return ret;
          },
          __wbg___wbindgen_is_string_dde0fd9020db4434: function __wbg___wbindgen_is_string_dde0fd9020db4434(arg0) {
            var ret = typeof arg0 === "string";
            return ret;
          },
          __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5(arg0) {
            var ret = arg0 === void 0;
            return ret;
          },
          __wbg___wbindgen_string_get_d109740c0d18f4d7: function __wbg___wbindgen_string_get_d109740c0d18f4d7(arg0, arg1) {
            var obj = arg1;
            var ret = typeof obj === "string" ? obj : void 0;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
          },
          __wbg___wbindgen_throw_9c31b086c2b26051: function __wbg___wbindgen_throw_9c31b086c2b26051(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
          },
          __wbg__wbg_cb_unref_3fa391f3fcdb55f8: function __wbg__wbg_cb_unref_3fa391f3fcdb55f8(arg0) {
            arg0._wbg_cb_unref();
          },
          __wbg_call_dfde26266607c996: function __wbg_call_dfde26266607c996() {
            return handleError(function(arg0, arg1, arg2) {
              var ret = arg0.call(arg1, arg2);
              return ret;
            }, arguments);
          },
          __wbg_crypto_0a92367f02a93895: function __wbg_crypto_0a92367f02a93895(arg0) {
            var ret = arg0.crypto;
            return ret;
          },
          __wbg_error_a6fa202b58aa1cd3: function __wbg_error_a6fa202b58aa1cd3(arg0, arg1) {
            var deferred0_0;
            var deferred0_1;
            try {
              deferred0_0 = arg0;
              deferred0_1 = arg1;
              console.error(getStringFromWasm0(arg0, arg1));
            } finally {
              wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
          },
          __wbg_fetch_c6f0d65561ded911: function __wbg_fetch_c6f0d65561ded911(arg0, arg1) {
            var ret = arg0.fetch(arg1);
            return ret;
          },
          __wbg_getRandomValues_d3f1739dc62f980a: function __wbg_getRandomValues_d3f1739dc62f980a() {
            return handleError(function(arg0, arg1) {
              arg0.getRandomValues(arg1);
            }, arguments);
          },
          __wbg_getTimezoneOffset_96cfb6ddebc9e5ca: function __wbg_getTimezoneOffset_96cfb6ddebc9e5ca(arg0) {
            var ret = arg0.getTimezoneOffset();
            return ret;
          },
          __wbg_get_location_hash_df50a35b9901319f: function __wbg_get_location_hash_df50a35b9901319f() {
            return handleError(function() {
              var ret = self.get_location_hash();
              return ret;
            }, arguments);
          },
          __wbg_instanceof_Error_b3f7e146d654031a: function __wbg_instanceof_Error_b3f7e146d654031a(arg0) {
            var result;
            try {
              result = arg0 instanceof Error;
            } catch (_) {
              result = false;
            }
            var ret = result;
            return ret;
          },
          __wbg_instanceof_Response_e5ecb2743393c4a2: function __wbg_instanceof_Response_e5ecb2743393c4a2(arg0) {
            var result;
            try {
              result = arg0 instanceof Response;
            } catch (_) {
              result = false;
            }
            var ret = result;
            return ret;
          },
          __wbg_instanceof_WorkerGlobalScope_54542d5589dfb0ba: function __wbg_instanceof_WorkerGlobalScope_54542d5589dfb0ba(arg0) {
            var result;
            try {
              result = arg0 instanceof WorkerGlobalScope;
            } catch (_) {
              result = false;
            }
            var ret = result;
            return ret;
          },
          __wbg_language_1ce90e43e76abd5e: function __wbg_language_1ce90e43e76abd5e(arg0, arg1) {
            var ret = arg1.language;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
          },
          __wbg_length_56fcd3e2b7e0299d: function __wbg_length_56fcd3e2b7e0299d(arg0) {
            var ret = arg0.length;
            return ret;
          },
          __wbg_local_storage_get_item_dc3db15a34cf0fcb: function __wbg_local_storage_get_item_dc3db15a34cf0fcb() {
            return handleError(function(arg0, arg1) {
              var deferred0_0;
              var deferred0_1;
              try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                var ret = self.local_storage_get_item(getStringFromWasm0(arg0, arg1));
                return ret;
              } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
              }
            }, arguments);
          },
          __wbg_local_storage_remove_item_253a1aee8e334d93: function __wbg_local_storage_remove_item_253a1aee8e334d93() {
            return handleError(function(arg0, arg1) {
              var deferred0_0;
              var deferred0_1;
              try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                var ret = self.local_storage_remove_item(getStringFromWasm0(arg0, arg1));
                return ret;
              } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
              }
            }, arguments);
          },
          __wbg_local_storage_set_item_90930f1054ec15ad: function __wbg_local_storage_set_item_90930f1054ec15ad() {
            return handleError(function(arg0, arg1, arg2, arg3) {
              var deferred0_0;
              var deferred0_1;
              var deferred1_0;
              var deferred1_1;
              try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                deferred1_0 = arg2;
                deferred1_1 = arg3;
                var ret = self.local_storage_set_item(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
                return ret;
              } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
              }
            }, arguments);
          },
          __wbg_log_0c201ade58bb55e1: function __wbg_log_0c201ade58bb55e1(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
            var deferred0_0;
            var deferred0_1;
            try {
              deferred0_0 = arg0;
              deferred0_1 = arg1;
              console.log(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
            } finally {
              wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
          },
          __wbg_log_ce2c4456b290c5e7: function __wbg_log_ce2c4456b290c5e7(arg0, arg1) {
            var deferred0_0;
            var deferred0_1;
            try {
              deferred0_0 = arg0;
              deferred0_1 = arg1;
              console.log(getStringFromWasm0(arg0, arg1));
            } finally {
              wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
          },
          __wbg_mark_b4d943f3bc2d2404: function __wbg_mark_b4d943f3bc2d2404(arg0, arg1) {
            performance.mark(getStringFromWasm0(arg0, arg1));
          },
          __wbg_measure_84362959e621a2c1: function __wbg_measure_84362959e621a2c1() {
            return handleError(function(arg0, arg1, arg2, arg3) {
              var deferred0_0;
              var deferred0_1;
              var deferred1_0;
              var deferred1_1;
              try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                deferred1_0 = arg2;
                deferred1_1 = arg3;
                performance.measure(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
              } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
              }
            }, arguments);
          },
          __wbg_message_324ac511aeaf710e: function __wbg_message_324ac511aeaf710e(arg0) {
            var ret = arg0.message;
            return ret;
          },
          __wbg_msCrypto_bcce18ddb1ca6c2d: function __wbg_msCrypto_bcce18ddb1ca6c2d(arg0) {
            var ret = arg0.msCrypto;
            return ret;
          },
          __wbg_navigator_db7d86c168d224ca: function __wbg_navigator_db7d86c168d224ca(arg0) {
            var ret = arg0.navigator;
            return ret;
          },
          __wbg_new_02d162bc6cf02f60: function __wbg_new_02d162bc6cf02f60() {
            var ret = new Object();
            return ret;
          },
          __wbg_new_227d7c05414eb861: function __wbg_new_227d7c05414eb861() {
            var ret = new Error();
            return ret;
          },
          __wbg_new_859b9002e2668e82: function __wbg_new_859b9002e2668e82(arg0) {
            var ret = new Date(arg0);
            return ret;
          },
          __wbg_new_typed_c072c4ce9a2a0cdf: function __wbg_new_typed_c072c4ce9a2a0cdf(arg0, arg1) {
            try {
              var state0 = {
                a: arg0,
                b: arg1
              };
              var cb0 = function cb02(arg02, arg12) {
                var a = state0.a;
                state0.a = 0;
                try {
                  return wasm_bindgen__convert__closures_____invoke__hb881961d1559463a(a, state0.b, arg02, arg12);
                } finally {
                  state0.a = a;
                }
              };
              var ret = new Promise(cb0);
              return ret;
            } finally {
              state0.a = 0;
            }
          },
          __wbg_new_with_length_99887c91eae4abab: function __wbg_new_with_length_99887c91eae4abab(arg0) {
            var ret = new Uint8Array(arg0 >>> 0);
            return ret;
          },
          __wbg_new_with_str_and_init_b298076a99bf2a5a: function __wbg_new_with_str_and_init_b298076a99bf2a5a() {
            return handleError(function(arg0, arg1, arg2) {
              var ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
              return ret;
            }, arguments);
          },
          __wbg_node_8ae12470cbc10fa7: function __wbg_node_8ae12470cbc10fa7(arg0) {
            var ret = arg0.node;
            return ret;
          },
          __wbg_now_81363d44c96dd239: function __wbg_now_81363d44c96dd239() {
            var ret = Date.now();
            return ret;
          },
          __wbg_parse_2c1cad6215e84999: function __wbg_parse_2c1cad6215e84999() {
            return handleError(function(arg0, arg1) {
              var ret = JSON.parse(getStringFromWasm0(arg0, arg1));
              return ret;
            }, arguments);
          },
          __wbg_process_c9cfbc1e2919260e: function __wbg_process_c9cfbc1e2919260e(arg0) {
            var ret = arg0.process;
            return ret;
          },
          __wbg_prototypesetcall_5f9bdc8d75e07276: function __wbg_prototypesetcall_5f9bdc8d75e07276(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
          },
          __wbg_queueMicrotask_78d584b53af520f5: function __wbg_queueMicrotask_78d584b53af520f5(arg0) {
            var ret = arg0.queueMicrotask;
            return ret;
          },
          __wbg_queueMicrotask_b39ea83c7f01971a: function __wbg_queueMicrotask_b39ea83c7f01971a(arg0) {
            queueMicrotask(arg0);
          },
          __wbg_randomFillSync_143a36904a882f2a: function __wbg_randomFillSync_143a36904a882f2a() {
            return handleError(function(arg0, arg1) {
              arg0.randomFillSync(arg1);
            }, arguments);
          },
          __wbg_require_def5a4782aa802ec: function __wbg_require_def5a4782aa802ec() {
            return handleError(function() {
              var ret = module.require;
              return ret;
            }, arguments);
          },
          __wbg_resolve_d17db9352f5a220e: function __wbg_resolve_d17db9352f5a220e(arg0) {
            var ret = Promise.resolve(arg0);
            return ret;
          },
          __wbg_setInterval_9f3fb04a7c15cf98: function __wbg_setInterval_9f3fb04a7c15cf98() {
            return handleError(function(arg0, arg1, arg2) {
              var ret = arg0.setInterval(arg1, arg2);
              return ret;
            }, arguments);
          },
          __wbg_set_a0e911be3da02782: function __wbg_set_a0e911be3da02782() {
            return handleError(function(arg0, arg1, arg2) {
              var ret = Reflect.set(arg0, arg1, arg2);
              return ret;
            }, arguments);
          },
          __wbg_stack_3b0d974bbf31e44f: function __wbg_stack_3b0d974bbf31e44f(arg0, arg1) {
            var ret = arg1.stack;
            var ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
          },
          __wbg_static_accessor_APP_VERSION_40cb987369a3af77: function __wbg_static_accessor_APP_VERSION_40cb987369a3af77(arg0) {
            var ret = self.app_version;
            var ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
          },
          __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9: function __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9() {
            var ret = typeof globalThis === "undefined" ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
          },
          __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54: function __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54() {
            var ret = typeof global === "undefined" ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
          },
          __wbg_static_accessor_SELF_9b2406c23aeb2023: function __wbg_static_accessor_SELF_9b2406c23aeb2023() {
            var ret = typeof self === "undefined" ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
          },
          __wbg_static_accessor_SHELL_VERSION_7ddb1ba024006c1e: function __wbg_static_accessor_SHELL_VERSION_7ddb1ba024006c1e(arg0) {
            var _self;
            var ret = typeof self === "undefined" ? null : (_self = self) === null || _self === void 0 ? void 0 : _self.shell_version;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
          },
          __wbg_static_accessor_WINDOW_b34d2126934e16ba: function __wbg_static_accessor_WINDOW_b34d2126934e16ba() {
            var ret = typeof window === "undefined" ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
          },
          __wbg_status_2c777a07423d94bb: function __wbg_status_2c777a07423d94bb(arg0) {
            var ret = arg0.status;
            return ret;
          },
          __wbg_stringify_ef0c105b1ccc3849: function __wbg_stringify_ef0c105b1ccc3849() {
            return handleError(function(arg0) {
              var ret = JSON.stringify(arg0);
              return ret;
            }, arguments);
          },
          __wbg_subarray_7c6a0da8f3b4a1ba: function __wbg_subarray_7c6a0da8f3b4a1ba(arg0, arg1, arg2) {
            var ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
          },
          __wbg_text_6347ea31f63c60db: function __wbg_text_6347ea31f63c60db() {
            return handleError(function(arg0) {
              var ret = arg0.text();
              return ret;
            }, arguments);
          },
          __wbg_then_837494e384b37459: function __wbg_then_837494e384b37459(arg0, arg1) {
            var ret = arg0.then(arg1);
            return ret;
          },
          __wbg_then_bd927500e8905df2: function __wbg_then_bd927500e8905df2(arg0, arg1, arg2) {
            var ret = arg0.then(arg1, arg2);
            return ret;
          },
          __wbg_versions_a8a74c7ca68bfe73: function __wbg_versions_a8a74c7ca68bfe73(arg0) {
            var ret = arg0.versions;
            return ret;
          },
          __wbindgen_cast_0000000000000001: function __wbindgen_cast_0000000000000001(arg0, arg1) {
            var ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hd55b456c30d272fd);
            return ret;
          },
          __wbindgen_cast_0000000000000002: function __wbindgen_cast_0000000000000002(arg0, arg1) {
            var ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h3853e0adab15ed32);
            return ret;
          },
          __wbindgen_cast_0000000000000003: function __wbindgen_cast_0000000000000003(arg0) {
            var ret = arg0;
            return ret;
          },
          __wbindgen_cast_0000000000000004: function __wbindgen_cast_0000000000000004(arg0, arg1) {
            var ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
          },
          __wbindgen_cast_0000000000000005: function __wbindgen_cast_0000000000000005(arg0, arg1) {
            var ret = getStringFromWasm0(arg0, arg1);
            return ret;
          },
          __wbindgen_init_externref_table: function __wbindgen_init_externref_table() {
            var table = wasm.__wbindgen_externrefs;
            var offset = table.grow(4);
            table.set(0, void 0);
            table.set(offset + 0, void 0);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
          }
        };
        return {
          __proto__: null,
          "./stremio_core_web_bg.js": import0
        };
      }
      function wasm_bindgen__convert__closures_____invoke__h3853e0adab15ed32(arg0, arg1) {
        wasm.wasm_bindgen__convert__closures_____invoke__h3853e0adab15ed32(arg0, arg1);
      }
      function wasm_bindgen__convert__closures_____invoke__hd55b456c30d272fd(arg0, arg1, arg2) {
        var ret = wasm.wasm_bindgen__convert__closures_____invoke__hd55b456c30d272fd(arg0, arg1, arg2);
        if (ret[1]) {
          throw takeFromExternrefTable0(ret[0]);
        }
      }
      function wasm_bindgen__convert__closures_____invoke__hb881961d1559463a(arg0, arg1, arg2, arg3) {
        wasm.wasm_bindgen__convert__closures_____invoke__hb881961d1559463a(arg0, arg1, arg2, arg3);
      }
      function addToExternrefTable0(obj) {
        var idx = wasm.__externref_table_alloc();
        wasm.__wbindgen_externrefs.set(idx, obj);
        return idx;
      }
      var CLOSURE_DTORS = typeof FinalizationRegistry === "undefined" ? {
        register: function register() {
        },
        unregister: function unregister() {
        }
      } : new FinalizationRegistry(function(state) {
        return wasm.__wbindgen_destroy_closure(state.a, state.b);
      });
      function debugString(val) {
        var type = (0, _typeof2["default"])(val);
        if (type == "number" || type == "boolean" || val == null) {
          return "".concat(val);
        }
        if (type == "string") {
          return '"'.concat(val, '"');
        }
        if (type == "symbol") {
          var description = val.description;
          if (description == null) {
            return "Symbol";
          } else {
            return "Symbol(".concat(description, ")");
          }
        }
        if (type == "function") {
          var name = val.name;
          if (typeof name == "string" && name.length > 0) {
            return "Function(".concat(name, ")");
          } else {
            return "Function";
          }
        }
        if (Array.isArray(val)) {
          var length = val.length;
          var debug = "[";
          if (length > 0) {
            debug += debugString(val[0]);
          }
          for (var i = 1; i < length; i++) {
            debug += ", " + debugString(val[i]);
          }
          debug += "]";
          return debug;
        }
        var builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
        var className;
        if (builtInMatches && builtInMatches.length > 1) {
          className = builtInMatches[1];
        } else {
          return toString.call(val);
        }
        if (className == "Object") {
          try {
            return "Object(" + JSON.stringify(val) + ")";
          } catch (_) {
            return "Object";
          }
        }
        if (val instanceof Error) {
          return "".concat(val.name, ": ").concat(val.message, "\n").concat(val.stack);
        }
        return className;
      }
      function getArrayU8FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
      }
      var cachedDataViewMemory0 = null;
      function getDataViewMemory0() {
        if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
          cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
        }
        return cachedDataViewMemory0;
      }
      function getStringFromWasm0(ptr, len) {
        return decodeText(ptr >>> 0, len);
      }
      var cachedUint8ArrayMemory0 = null;
      function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
          cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
      }
      function handleError(f, args) {
        try {
          return f.apply(this, args);
        } catch (e) {
          var idx = addToExternrefTable0(e);
          wasm.__wbindgen_exn_store(idx);
        }
      }
      function isLikeNone(x) {
        return x === void 0 || x === null;
      }
      function makeMutClosure(arg0, arg1, f) {
        var state = {
          a: arg0,
          b: arg1,
          cnt: 1
        };
        var real = function real2() {
          state.cnt++;
          var a = state.a;
          state.a = 0;
          try {
            for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
              args[_key] = arguments[_key];
            }
            return f.apply(void 0, [a, state.b].concat(args));
          } finally {
            state.a = a;
            real2._wbg_cb_unref();
          }
        };
        real._wbg_cb_unref = function() {
          if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
          }
        };
        CLOSURE_DTORS.register(real, state, state);
        return real;
      }
      function passStringToWasm0(arg, malloc, realloc) {
        if (realloc === void 0) {
          var buf = cachedTextEncoder.encode(arg);
          var _ptr = malloc(buf.length, 1) >>> 0;
          getUint8ArrayMemory0().subarray(_ptr, _ptr + buf.length).set(buf);
          WASM_VECTOR_LEN = buf.length;
          return _ptr;
        }
        var len = arg.length;
        var ptr = malloc(len, 1) >>> 0;
        var mem = getUint8ArrayMemory0();
        var offset = 0;
        for (; offset < len; offset++) {
          var code = arg.charCodeAt(offset);
          if (code > 127) break;
          mem[ptr + offset] = code;
        }
        if (offset !== len) {
          if (offset !== 0) {
            arg = arg.slice(offset);
          }
          ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
          var view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
          var ret = cachedTextEncoder.encodeInto(arg, view);
          offset += ret.written;
          ptr = realloc(ptr, len, offset, 1) >>> 0;
        }
        WASM_VECTOR_LEN = offset;
        return ptr;
      }
      function takeFromExternrefTable0(idx) {
        var value = wasm.__wbindgen_externrefs.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
      }
      var cachedTextDecoder = new TextDecoder("utf-8", {
        ignoreBOM: true,
        fatal: true
      });
      cachedTextDecoder.decode();
      var MAX_SAFARI_DECODE_BYTES = 2146435072;
      var numBytesDecoded = 0;
      function decodeText(ptr, len) {
        numBytesDecoded += len;
        if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
          cachedTextDecoder = new TextDecoder("utf-8", {
            ignoreBOM: true,
            fatal: true
          });
          cachedTextDecoder.decode();
          numBytesDecoded = len;
        }
        return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
      }
      var cachedTextEncoder = new TextEncoder();
      if (!("encodeInto" in cachedTextEncoder)) {
        cachedTextEncoder.encodeInto = function(arg, view) {
          var buf = cachedTextEncoder.encode(arg);
          view.set(buf);
          return {
            read: arg.length,
            written: buf.length
          };
        };
      }
      var WASM_VECTOR_LEN = 0;
      var wasmModule;
      var wasmInstance;
      var wasm;
      function __wbg_finalize_init(instance, module2) {
        wasmInstance = instance;
        wasm = instance.exports;
        wasmModule = module2;
        cachedDataViewMemory0 = null;
        cachedUint8ArrayMemory0 = null;
        wasm.__wbindgen_start();
        return wasm;
      }
      function __wbg_load(_x, _x2) {
        return _wbg_load.apply(this, arguments);
      }
      function _wbg_load() {
        _wbg_load = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee(module2, imports) {
          var validResponse, bytes, instance, expectedResponseType;
          return _regenerator["default"].wrap(function _callee$(_context) {
            while (1) switch (_context.prev = _context.next) {
              case 0:
                expectedResponseType = function _expectedResponseType(type) {
                  switch (type) {
                    case "basic":
                    case "cors":
                    case "default":
                      return true;
                  }
                  return false;
                };
                if (!(typeof Response === "function" && module2 instanceof Response)) {
                  _context.next = 25;
                  break;
                }
                if (!(typeof WebAssembly.instantiateStreaming === "function")) {
                  _context.next = 17;
                  break;
                }
                _context.prev = 3;
                _context.next = 6;
                return WebAssembly.instantiateStreaming(module2, imports);
              case 6:
                return _context.abrupt("return", _context.sent);
              case 9:
                _context.prev = 9;
                _context.t0 = _context["catch"](3);
                validResponse = module2.ok && expectedResponseType(module2.type);
                if (!(validResponse && module2.headers.get("Content-Type") !== "application/wasm")) {
                  _context.next = 16;
                  break;
                }
                console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", _context.t0);
                _context.next = 17;
                break;
              case 16:
                throw _context.t0;
              case 17:
                _context.next = 19;
                return module2.arrayBuffer();
              case 19:
                bytes = _context.sent;
                _context.next = 22;
                return WebAssembly.instantiate(bytes, imports);
              case 22:
                return _context.abrupt("return", _context.sent);
              case 25:
                _context.next = 27;
                return WebAssembly.instantiate(module2, imports);
              case 27:
                instance = _context.sent;
                if (!(instance instanceof WebAssembly.Instance)) {
                  _context.next = 32;
                  break;
                }
                return _context.abrupt("return", {
                  instance,
                  module: module2
                });
              case 32:
                return _context.abrupt("return", instance);
              case 33:
              case "end":
                return _context.stop();
            }
          }, _callee, null, [[3, 9]]);
        }));
        return _wbg_load.apply(this, arguments);
      }
      function initSync(module2) {
        if (wasm !== void 0) return wasm;
        if (module2 !== void 0) {
          if (Object.getPrototypeOf(module2) === Object.prototype) {
            var _module = module2;
            module2 = _module.module;
          } else {
            console.warn("using deprecated parameters for `initSync()`; pass a single object instead");
          }
        }
        var imports = __wbg_get_imports();
        if (!(module2 instanceof WebAssembly.Module)) {
          module2 = new WebAssembly.Module(module2);
        }
        var instance = new WebAssembly.Instance(module2, imports);
        return __wbg_finalize_init(instance, module2);
      }
      function __wbg_init(_x3) {
        return _wbg_init.apply(this, arguments);
      }
      function _wbg_init() {
        _wbg_init = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee2(module_or_path) {
          var _module_or_path, imports, _yield$__wbg_load, instance, module2;
          return _regenerator["default"].wrap(function _callee2$(_context2) {
            while (1) switch (_context2.prev = _context2.next) {
              case 0:
                if (!(wasm !== void 0)) {
                  _context2.next = 2;
                  break;
                }
                return _context2.abrupt("return", wasm);
              case 2:
                if (module_or_path !== void 0) {
                  if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
                    _module_or_path = module_or_path;
                    module_or_path = _module_or_path.module_or_path;
                  } else {
                    console.warn("using deprecated parameters for the initialization function; pass a single object instead");
                  }
                }
                if (module_or_path === void 0) {
                  module_or_path = new URL("stremio_core_web_bg.wasm", importMeta.url);
                }
                imports = __wbg_get_imports();
                if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
                  module_or_path = fetch(module_or_path);
                }
                _context2.t0 = __wbg_load;
                _context2.next = 9;
                return module_or_path;
              case 9:
                _context2.t1 = _context2.sent;
                _context2.t2 = imports;
                _context2.next = 13;
                return (0, _context2.t0)(_context2.t1, _context2.t2);
              case 13:
                _yield$__wbg_load = _context2.sent;
                instance = _yield$__wbg_load.instance;
                module2 = _yield$__wbg_load.module;
                return _context2.abrupt("return", __wbg_finalize_init(instance, module2));
              case 17:
              case "end":
                return _context2.stop();
            }
          }, _callee2);
        }));
        return _wbg_init.apply(this, arguments);
      }
    }
  });

  // node_modules/@stremio/stremio-core-web/stremio_core_web_bg.wasm
  var require_stremio_core_web_bg = __commonJS({
    "node_modules/@stremio/stremio-core-web/stremio_core_web_bg.wasm"(exports, module) {
      module.exports = "./stremio_core_web_bg.wasm";
    }
  });

  // node_modules/@stremio/stremio-core-web/worker.js
  var require_worker = __commonJS({
    "node_modules/@stremio/stremio-core-web/worker.js"() {
      "use strict";
      var _interopRequireDefault = require_interopRequireDefault();
      var _regenerator = _interopRequireDefault(require_regenerator());
      var _asyncToGenerator2 = _interopRequireDefault(require_asyncToGenerator());
      var Bridge = require_bridge();
      var bridge = new Bridge(self, self);
      self.init = /* @__PURE__ */ (function() {
        var _ref2 = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee5(_ref) {
          var appVersion, shellVersion, _require, initialize_api, initialize_runtime, get_state, get_debug_state, dispatch, analytics, decode_stream, encode_stream;
          return _regenerator["default"].wrap(function _callee5$(_context5) {
            while (1) switch (_context5.prev = _context5.next) {
              case 0:
                appVersion = _ref.appVersion, shellVersion = _ref.shellVersion;
                self.document = {
                  baseURI: self.location.href
                };
                self.app_version = appVersion;
                self.shell_version = shellVersion;
                self.get_location_hash = /* @__PURE__ */ (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee() {
                  return _regenerator["default"].wrap(function _callee$(_context) {
                    while (1) switch (_context.prev = _context.next) {
                      case 0:
                        return _context.abrupt("return", bridge.call(["location", "hash"], []));
                      case 1:
                      case "end":
                        return _context.stop();
                    }
                  }, _callee);
                }));
                self.local_storage_get_item = /* @__PURE__ */ (function() {
                  var _ref4 = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee2(key) {
                    return _regenerator["default"].wrap(function _callee2$(_context2) {
                      while (1) switch (_context2.prev = _context2.next) {
                        case 0:
                          return _context2.abrupt("return", bridge.call(["localStorage", "getItem"], [key]));
                        case 1:
                        case "end":
                          return _context2.stop();
                      }
                    }, _callee2);
                  }));
                  return function(_x2) {
                    return _ref4.apply(this, arguments);
                  };
                })();
                self.local_storage_set_item = /* @__PURE__ */ (function() {
                  var _ref5 = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee3(key, value) {
                    return _regenerator["default"].wrap(function _callee3$(_context3) {
                      while (1) switch (_context3.prev = _context3.next) {
                        case 0:
                          return _context3.abrupt("return", bridge.call(["localStorage", "setItem"], [key, value]));
                        case 1:
                        case "end":
                          return _context3.stop();
                      }
                    }, _callee3);
                  }));
                  return function(_x3, _x4) {
                    return _ref5.apply(this, arguments);
                  };
                })();
                self.local_storage_remove_item = /* @__PURE__ */ (function() {
                  var _ref6 = (0, _asyncToGenerator2["default"])(/* @__PURE__ */ _regenerator["default"].mark(function _callee4(key) {
                    return _regenerator["default"].wrap(function _callee4$(_context4) {
                      while (1) switch (_context4.prev = _context4.next) {
                        case 0:
                          return _context4.abrupt("return", bridge.call(["localStorage", "removeItem"], [key]));
                        case 1:
                        case "end":
                          return _context4.stop();
                      }
                    }, _callee4);
                  }));
                  return function(_x5) {
                    return _ref6.apply(this, arguments);
                  };
                })();
                _require = require_stremio_core_web(), initialize_api = _require["default"], initialize_runtime = _require.initialize_runtime, get_state = _require.get_state, get_debug_state = _require.get_debug_state, dispatch = _require.dispatch, analytics = _require.analytics, decode_stream = _require.decode_stream, encode_stream = _require.encode_stream;
                self.getState = get_state;
                self.getDebugState = get_debug_state;
                self.dispatch = dispatch;
                self.analytics = analytics;
                self.decodeStream = decode_stream;
                self.encodeStream = encode_stream;
                _context5.next = 17;
                return initialize_api(require_stremio_core_web_bg());
              case 17:
                _context5.next = 19;
                return initialize_runtime(function(event) {
                  return bridge.call(["onCoreEvent"], [event]);
                });
              case 19:
              case "end":
                return _context5.stop();
            }
          }, _callee5);
        }));
        return function(_x) {
          return _ref2.apply(this, arguments);
        };
      })();
    }
  });

  // core/worker-entry.js
  require_worker();
})();
/*! Bundled license information:

@babel/runtime/helpers/regeneratorRuntime.js:
  (*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE *)
*/
