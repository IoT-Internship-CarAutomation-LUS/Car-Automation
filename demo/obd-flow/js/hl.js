// hl.js -- load the vendored highlight.js core with only Python and JavaScript, then tell flow.js.
import hljs from "../vendor/highlight/core.min.js";
import python from "../vendor/highlight/python.min.js";
import javascript from "../vendor/highlight/javascript.min.js";

hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
window.hljs = hljs;
window.dispatchEvent(new Event("hljs-ready"));
