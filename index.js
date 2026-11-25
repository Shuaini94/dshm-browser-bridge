/**
 * dshm-browser-bridge —— 把「浏览器自动化」装进 DSHM 的插件（单文件版）。
 *
 * 启动时做两件事：
 *   1. 在宿主进程里起本地 HTTP 桥（127.0.0.1:8765），供浏览器扩展轮询 / 回传结果；
 *   2. 把内置的浏览器扩展源码写到 <workspace>/browser-bridge-extension/，
 *      供用户在浏览器里「加载已解压的扩展程序」。
 *
 * 端点：
 *   GET  /cmd?c=<client>&u=<pageUrl>        扩展轮询取任务（按 target 匹配页面）
 *   POST /result                            扩展回传结果
 *   POST /hello                             扩展上报上线
 *   POST /enqueue {action,params,target}    入队命令，返回 {id}
 *   GET  /get?id=<id>                       取结果（未完成返回 {pending:true}）
 *   GET  /hello_list                        已上线客户端
 *   GET  /ext/<file>                        下载扩展文件
 *
 * 边界：本插件不安装浏览器扩展 —— Chrome 内核只接受用户手动「加载已解压的扩展程序」。
 */
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const name = 'dshm-browser-bridge';
const PORT = Number(process.env.DSHM_BRIDGE_PORT || 8765);

/** 内置扩展源码（base64，避免模板字符串转义问题）。 */
const EXT = {
  'manifest.json': 'ewogICJtYW5pZmVzdF92ZXJzaW9uIjogMywKICAibmFtZSI6ICJEU0hNIEJyaWRnZSBMaXRlIiwKICAidmVyc2lvbiI6ICIxLjguMCIsCiAgImRlc2NyaXB0aW9uIjogIuacrOWcsOS4tOaXtuahpe+8muWPqui/niAxMjcuMC4wLjHvvIznlLHmnKzmnLogQWdlbnQg6amx5Yqo5Lu75oSP572R6aG177yI5YWo56uZ5rOo5YWl77yJ44CCIiwKICAibWluaW11bV9jaHJvbWVfdmVyc2lvbiI6ICIxMDIiLAogICJwZXJtaXNzaW9ucyI6IFsKICAgICJ0YWJzIiwKICAgICJzY3JpcHRpbmciCiAgXSwKICAiaG9zdF9wZXJtaXNzaW9ucyI6IFsKICAgICJodHRwOi8vMTI3LjAuMC4xLyoiLAogICAgIjxhbGxfdXJscz4iCiAgXSwKICAiYmFja2dyb3VuZCI6IHsKICAgICJzZXJ2aWNlX3dvcmtlciI6ICJiZy5qcyIKICB9LAogICJjb250ZW50X3NjcmlwdHMiOiBbCiAgICB7CiAgICAgICJtYXRjaGVzIjogWwogICAgICAgICI8YWxsX3VybHM+IgogICAgICBdLAogICAgICAianMiOiBbCiAgICAgICAgImNzLmpzIgogICAgICBdLAogICAgICAicnVuX2F0IjogImRvY3VtZW50X2lkbGUiLAogICAgICAiYWxsX2ZyYW1lcyI6IGZhbHNlCiAgICB9CiAgXQp9',
  'bg.js': 'Ly8gRFNITSBCcmlkZ2UgTGl0ZSAxLjMg4oCUIOi9rOWPke+8muWGheWuueiEmuacrOi9ruivouacrOacuuacjeWKoe+8m+WQjuWPsOi0n+i0oyBIVFRQ77yI5ZCr6Leo5Z+f5o6l5Y+j6LCD55So77yJ44CCCmNvbnN0IEJBU0UgPSAiaHR0cDovLzEyNy4wLjAuMTo4Nzc2IjsKY29uc3QgQ0xJRU5UID0gImxpdGUtIiArIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDgpOwoKYXN5bmMgZnVuY3Rpb24gcG9zdChwYXRoLCBvYmopIHsKICBhd2FpdCBmZXRjaChCQVNFICsgcGF0aCwgewogICAgbWV0aG9kOiAiUE9TVCIsCiAgICBoZWFkZXJzOiB7ICJDb250ZW50LVR5cGUiOiAiYXBwbGljYXRpb24vanNvbiIgfSwKICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KG9iaiksCiAgICBjYWNoZTogIm5vLXN0b3JlIgogIH0pLmNhdGNoKCgpID0+IHt9KTsKfQoKYXN5bmMgZnVuY3Rpb24gZ2V0Q21kKHBhZ2VVcmwpIHsKICBjb25zdCBxID0gQkFTRSArICIvY21kP2M9IiArIGVuY29kZVVSSUNvbXBvbmVudChDTElFTlQpICsgIiZ1PSIgKyBlbmNvZGVVUklDb21wb25lbnQocGFnZVVybCB8fCAiIik7CiAgY29uc3QgciA9IGF3YWl0IGZldGNoKHEsIHsgY2FjaGU6ICJuby1zdG9yZSIgfSk7CiAgaWYgKCFyLm9rKSByZXR1cm4geyBpZDogbnVsbCB9OwogIHJldHVybiByLmpzb24oKTsKfQoKYXN5bmMgZnVuY3Rpb24gYXBpQ2FsbChwKSB7CiAgY29uc3QgaW5pdCA9IHsgbWV0aG9kOiBwLm1ldGhvZCB8fCAiR0VUIiwgaGVhZGVyczogT2JqZWN0LmFzc2lnbih7fSwgcC5oZWFkZXJzIHx8IHt9KSwgY2FjaGU6ICJuby1zdG9yZSIgfTsKICBpZiAocC5ib2R5ICE9IG51bGwpIGluaXQuYm9keSA9IHR5cGVvZiBwLmJvZHkgPT09ICJzdHJpbmciID8gcC5ib2R5IDogSlNPTi5zdHJpbmdpZnkocC5ib2R5KTsKICBjb25zdCByID0gYXdhaXQgZmV0Y2gocC51cmwsIGluaXQpOwogIGNvbnN0IHRleHQgPSBhd2FpdCByLnRleHQoKTsKICBsZXQgZGF0YSA9IG51bGw7CiAgdHJ5IHsgZGF0YSA9IEpTT04ucGFyc2UodGV4dCk7IH0gY2F0Y2ggKGUpIHsgZGF0YSA9IHRleHQuc2xpY2UoMCwgMjAwMCk7IH0KICByZXR1cm4geyBvazogci5vaywgc3RhdHVzOiByLnN0YXR1cywgZGF0YSB9Owp9CgoKYXN5bmMgZnVuY3Rpb24gd2FpdENvbXBsZXRlKHRhYklkLCB0aW1lb3V0TXMpIHsKICBjb25zdCB0MCA9IERhdGUubm93KCk7CiAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7CiAgICBjb25zdCB0aWNrID0gKCkgPT4gewogICAgICBjaHJvbWUudGFicy5nZXQodGFiSWQsICh0KSA9PiB7CiAgICAgICAgaWYgKCF0IHx8IHQuc3RhdHVzID09PSAiY29tcGxldGUiIHx8IERhdGUubm93KCkgLSB0MCA+ICh0aW1lb3V0TXMgfHwgMTUwMDApKSByZXNvbHZlKHQgfHwgbnVsbCk7CiAgICAgICAgZWxzZSBzZXRUaW1lb3V0KHRpY2ssIDMwMCk7CiAgICAgIH0pOwogICAgfTsKICAgIHRpY2soKTsKICB9KTsKfQoKYXN5bmMgZnVuY3Rpb24gb3BlblRhYihwYXJhbXMpIHsKICBjb25zdCB1cmwgPSBwYXJhbXMudXJsOwogIGxldCB0YWI7CiAgaWYgKHBhcmFtcy5uZXdUYWIgPT09IGZhbHNlKSB7CiAgICBjb25zdCBbY3VyXSA9IGF3YWl0IGNocm9tZS50YWJzLnF1ZXJ5KHsgYWN0aXZlOiB0cnVlLCBsYXN0Rm9jdXNlZFdpbmRvdzogdHJ1ZSB9KTsKICAgIHRhYiA9IGN1ciA/IGF3YWl0IGNocm9tZS50YWJzLnVwZGF0ZShjdXIuaWQsIHsgdXJsOiB1cmwsIGFjdGl2ZTogdHJ1ZSB9KSA6IGF3YWl0IGNocm9tZS50YWJzLmNyZWF0ZSh7IHVybDogdXJsIH0pOwogIH0gZWxzZSB7CiAgICB0YWIgPSBhd2FpdCBjaHJvbWUudGFicy5jcmVhdGUoeyB1cmw6IHVybCwgYWN0aXZlOiB0cnVlIH0pOwogIH0KICBhd2FpdCB3YWl0Q29tcGxldGUodGFiLmlkLCBwYXJhbXMudGltZW91dCB8fCAxNTAwMCk7CiAgcmV0dXJuIHsgb2s6IHRydWUsIHRhYklkOiB0YWIuaWQsIHVybDogdXJsIH07Cn0KCmFzeW5jIGZ1bmN0aW9uIGxpc3RUYWJzKCkgewogIGNvbnN0IHRhYnMgPSBhd2FpdCBjaHJvbWUudGFicy5xdWVyeSh7fSk7CiAgcmV0dXJuIHsgb2s6IHRydWUsIHRhYnM6IHRhYnMubWFwKCh0KSA9PiAoeyBpZDogdC5pZCwgdXJsOiB0LnVybCwgdGl0bGU6IHQudGl0bGUsIGFjdGl2ZTogdC5hY3RpdmUsIHN0YXR1czogdC5zdGF0dXMgfSkpIH07Cn0KCmNocm9tZS5ydW50aW1lLm9uTWVzc2FnZS5hZGRMaXN0ZW5lcigobXNnLCBzZW5kZXIsIHNlbmRSZXNwb25zZSkgPT4gewogIGlmIChtc2cgJiYgbXNnLnR5cGUgPT09ICJwb2xsIikgewogICAgZ2V0Q21kKG1zZy51cmwpLnRoZW4oKGMpID0+IHNlbmRSZXNwb25zZShjIHx8IHsgaWQ6IG51bGwgfSkpLmNhdGNoKCgpID0+IHNlbmRSZXNwb25zZSh7IGlkOiBudWxsIH0pKTsKICAgIHJldHVybiB0cnVlOwogIH0KICBpZiAobXNnICYmIG1zZy50eXBlID09PSAicmVzdWx0IikgewogICAgcG9zdCgiL3Jlc3VsdCIsIHsgaWQ6IG1zZy5pZCwgY2xpZW50OiBDTElFTlQsIHJlc3VsdDogbXNnLnJlc3VsdCwgZXJyb3I6IG1zZy5lcnJvciB9KQogICAgICAudGhlbigoKSA9PiBzZW5kUmVzcG9uc2UoeyBvazogdHJ1ZSB9KSk7CiAgICByZXR1cm4gdHJ1ZTsKICB9CiAgaWYgKG1zZyAmJiBtc2cudHlwZSA9PT0gIm9wZW4iKSB7CiAgICBvcGVuVGFiKG1zZy5wYXJhbXMgfHwge30pLnRoZW4oKHIpID0+IHNlbmRSZXNwb25zZShyKSkuY2F0Y2goKGUpID0+IHNlbmRSZXNwb25zZSh7IG9rOiBmYWxzZSwgZXJyb3I6IFN0cmluZyhlKSB9KSk7CiAgICByZXR1cm4gdHJ1ZTsKICB9CiAgaWYgKG1zZyAmJiBtc2cudHlwZSA9PT0gInRhYnMiKSB7CiAgICBsaXN0VGFicygpLnRoZW4oKHIpID0+IHNlbmRSZXNwb25zZShyKSkuY2F0Y2goKGUpID0+IHNlbmRSZXNwb25zZSh7IG9rOiBmYWxzZSwgZXJyb3I6IFN0cmluZyhlKSB9KSk7CiAgICByZXR1cm4gdHJ1ZTsKICB9CiAgaWYgKG1zZyAmJiBtc2cudHlwZSA9PT0gImFwaSIpIHsKICAgIGFwaUNhbGwobXNnLnBhcmFtcyB8fCB7fSkudGhlbigocikgPT4gc2VuZFJlc3BvbnNlKHIpKS5jYXRjaCgoZSkgPT4gc2VuZFJlc3BvbnNlKHsgb2s6IGZhbHNlLCBlcnJvcjogU3RyaW5nKGUpIH0pKTsKICAgIHJldHVybiB0cnVlOwogIH0KICByZXR1cm4gZmFsc2U7Cn0pOwoKY2hyb21lLnJ1bnRpbWUub25JbnN0YWxsZWQuYWRkTGlzdGVuZXIoKCkgPT4geyBwb3N0KCIvaGVsbG8iLCB7IGNsaWVudDogQ0xJRU5UIH0pOyB9KTsKcG9zdCgiL2hlbGxvIiwgeyBjbGllbnQ6IENMSUVOVCB9KTsK',
  'cs.js': 'Ly8g5YaF5a656ISa5pysIHYxLjLvvJrova7or6LmnKzmnLrmoaXvvIzmiafooYwgRE9NIOaTjeS9nO+8iOS4jeS+nei1liBldmFs77yM6YG/5byA6aG16Z2iIENTUO+8ieOAggpsZXQgYnVzeSA9IGZhbHNlOwpjb25zdCBzbGVlcCA9IChtcykgPT4gbmV3IFByb21pc2UoKHIpID0+IHNldFRpbWVvdXQociwgbXMpKTsKCmZ1bmN0aW9uIGFsbEVscygpIHsKICByZXR1cm4gQXJyYXkuZnJvbShkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCJidXR0b24sYSxzcGFuLGRpdixsaSx0ZCxsYWJlbCxpLHAsc3Ryb25nIikpOwp9CmZ1bmN0aW9uIHRleHRPZihlbCkgewogIHJldHVybiAoKGVsLmlubmVyVGV4dCB8fCBlbC50ZXh0Q29udGVudCB8fCAiIikgKyAiIikudHJpbSgpOwp9CmZ1bmN0aW9uIGJ5VGV4dCh0eHQsIGV4YWN0KSB7CiAgY29uc3QgdCA9IFN0cmluZyh0eHQpLnRyaW0oKTsKICBjb25zdCBlbHMgPSBhbGxFbHMoKTsKICBjb25zdCBjYW5kcyA9IGVscy5maWx0ZXIoKGUpID0+IHsKICAgIGNvbnN0IHMgPSB0ZXh0T2YoZSk7CiAgICByZXR1cm4gZXhhY3QgPyBzID09PSB0IDogcy5pbmRleE9mKHQpID49IDA7CiAgfSk7CiAgaWYgKCFjYW5kcy5sZW5ndGgpIHJldHVybiBudWxsOwogIGNhbmRzLnNvcnQoKGEsIGIpID0+IHRleHRPZihhKS5sZW5ndGggLSB0ZXh0T2YoYikubGVuZ3RoKTsKICByZXR1cm4gY2FuZHNbMF07Cn0KZnVuY3Rpb24gZmlyZShlbCwgdHlwZSwgb3B0cykgewogIGNvbnN0IGV2ID0gbmV3IE1vdXNlRXZlbnQodHlwZSwgT2JqZWN0LmFzc2lnbih7CiAgICBidWJibGVzOiB0cnVlLCBjYW5jZWxhYmxlOiB0cnVlLCB2aWV3OiB3aW5kb3csIGJ1dHRvbjogMAogIH0sIG9wdHMgfHwge30pKTsKICBlbC5kaXNwYXRjaEV2ZW50KGV2KTsKfQpmdW5jdGlvbiBjbGlja1NlcShlbCkgewogIGVsLnNjcm9sbEludG9WaWV3KHsgYmxvY2s6ICJjZW50ZXIiLCBpbmxpbmU6ICJjZW50ZXIiIH0pOwogIGNvbnN0IHIgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsKICBjb25zdCB4ID0gci5sZWZ0ICsgci53aWR0aCAvIDIsIHkgPSByLnRvcCArIHIuaGVpZ2h0IC8gMjsKICBjb25zdCBvID0geyBjbGllbnRYOiB4LCBjbGllbnRZOiB5LCBzY3JlZW5YOiB4LCBzY3JlZW5ZOiB5IH07CiAgZmlyZShlbCwgInBvaW50ZXJvdmVyIiwgbyk7IGZpcmUoZWwsICJtb3VzZW92ZXIiLCBvKTsgZmlyZShlbCwgIm1vdXNlZW50ZXIiLCBvKTsKICBmaXJlKGVsLCAicG9pbnRlcmRvd24iLCBvKTsgZmlyZShlbCwgIm1vdXNlZG93biIsIG8pOwogIGZpcmUoZWwsICJwb2ludGVydXAiLCBvKTsgZmlyZShlbCwgIm1vdXNldXAiLCBvKTsKICBmaXJlKGVsLCAiY2xpY2siLCBvKTsKfQpmdW5jdGlvbiBob3ZlclNlcShlbCkgewogIGVsLnNjcm9sbEludG9WaWV3KHsgYmxvY2s6ICJjZW50ZXIiLCBpbmxpbmU6ICJjZW50ZXIiIH0pOwogIGNvbnN0IHIgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsKICBjb25zdCBvID0geyBjbGllbnRYOiByLmxlZnQgKyByLndpZHRoIC8gMiwgY2xpZW50WTogci50b3AgKyByLmhlaWdodCAvIDIgfTsKICBmaXJlKGVsLCAicG9pbnRlcm92ZXIiLCBvKTsgZmlyZShlbCwgIm1vdXNlb3ZlciIsIG8pOyBmaXJlKGVsLCAibW91c2VlbnRlciIsIG8pOwogIGZpcmUoZWwsICJtb3VzZW1vdmUiLCBvKTsKfQpmdW5jdGlvbiBzZXRWYWx1ZShlbCwgdmFsKSB7CiAgY29uc3QgcHJvdG8gPSBlbC50YWdOYW1lID09PSAiVEVYVEFSRUEiID8gSFRNTFRleHRBcmVhRWxlbWVudC5wcm90b3R5cGUgOiBIVE1MSW5wdXRFbGVtZW50LnByb3RvdHlwZTsKICBjb25zdCBkZXNjID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90bywgInZhbHVlIik7CiAgaWYgKGRlc2MgJiYgZGVzYy5zZXQpIGRlc2Muc2V0LmNhbGwoZWwsIHZhbCk7IGVsc2UgZWwudmFsdWUgPSB2YWw7CiAgZWwuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoImlucHV0IiwgeyBidWJibGVzOiB0cnVlIH0pKTsKICBlbC5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgiY2hhbmdlIiwgeyBidWJibGVzOiB0cnVlIH0pKTsKfQpmdW5jdGlvbiByZXNvbHZlKHApIHsKICBpZiAocC5zZWxlY3RvcikgeyB0cnkgeyByZXR1cm4gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihwLnNlbGVjdG9yKTsgfSBjYXRjaCAoZSkgeyByZXR1cm4gbnVsbDsgfSB9CiAgaWYgKHAudGV4dCAhPSBudWxsKSByZXR1cm4gYnlUZXh0KHAudGV4dCwgcC5leGFjdCA9PT0gdHJ1ZSk7CiAgcmV0dXJuIG51bGw7Cn0KZnVuY3Rpb24gcXVlcnlBbGwoc2VsLCBsaW1pdCkgewogIHJldHVybiBBcnJheS5mcm9tKGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoc2VsKSkuc2xpY2UoMCwgbGltaXQgfHwgNTApLm1hcCgoZSwgaSkgPT4gKHsKICAgIGksIHRhZzogZS50YWdOYW1lLCBjbHM6IChlLmNsYXNzTmFtZSB8fCAiIikudG9TdHJpbmcoKS5zbGljZSgwLCA4MCksIHRleHQ6IHRleHRPZihlKS5zbGljZSgwLCA4MCksCiAgICB2aXNpYmxlOiAhIShlLm9mZnNldFdpZHRoIHx8IGUub2Zmc2V0SGVpZ2h0KQogIH0pKTsKfQoKYXN5bmMgZnVuY3Rpb24gcnVuKGNtZCkgewogIGNvbnN0IHAgPSBjbWQucGFyYW1zIHx8IHt9OwogIHN3aXRjaCAoY21kLmFjdGlvbikgewogICAgY2FzZSAic3RhdHVzIjoKICAgICAgcmV0dXJuIHsgdXJsOiBsb2NhdGlvbi5ocmVmLCB0aXRsZTogZG9jdW1lbnQudGl0bGUsIHJlYWR5OiBkb2N1bWVudC5yZWFkeVN0YXRlIH07CiAgICBjYXNlICJnb3RvIjoKICAgICAgbG9jYXRpb24uaHJlZiA9IHAudXJsOyByZXR1cm4geyBvazogdHJ1ZSB9OwogICAgY2FzZSAidGV4dCI6CiAgICAgIHJldHVybiB7IHRleHQ6IChkb2N1bWVudC5ib2R5ID8gZG9jdW1lbnQuYm9keS5pbm5lclRleHQgOiAiIikuc2xpY2UoMCwgcC5saW1pdCB8fCAyMDAwMCkgfTsKICAgIGNhc2UgImh0bWwiOgogICAgICByZXR1cm4geyBodG1sOiBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQub3V0ZXJIVE1MLnNsaWNlKDAsIHAubGltaXQgfHwgNTAwMDApIH07CiAgICBjYXNlICJjbGljayI6IHsKICAgICAgY29uc3QgZWwgPSByZXNvbHZlKHApOwogICAgICBpZiAoIWVsKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAibm90IGZvdW5kIiB9OwogICAgICBjbGlja1NlcShlbCk7CiAgICAgIGF3YWl0IHNsZWVwKHAud2FpdCB8fCAzMDApOwogICAgICByZXR1cm4geyBvazogdHJ1ZSwgdGFnOiBlbC50YWdOYW1lLCB0ZXh0OiB0ZXh0T2YoZWwpLnNsaWNlKDAsIDYwKSB9OwogICAgfQogICAgY2FzZSAiaG92ZXIiOiB7CiAgICAgIGNvbnN0IGVsID0gcmVzb2x2ZShwKTsKICAgICAgaWYgKCFlbCkgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogIm5vdCBmb3VuZCIgfTsKICAgICAgaG92ZXJTZXEoZWwpOwogICAgICBhd2FpdCBzbGVlcChwLndhaXQgfHwgNTAwKTsKICAgICAgcmV0dXJuIHsgb2s6IHRydWUsIHRhZzogZWwudGFnTmFtZSwgdGV4dDogdGV4dE9mKGVsKS5zbGljZSgwLCA2MCkgfTsKICAgIH0KICAgIGNhc2UgImZpbGwiOiB7CiAgICAgIGNvbnN0IGVsID0gcmVzb2x2ZShwKTsKICAgICAgaWYgKCFlbCkgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogImlucHV0IG5vdCBmb3VuZCIgfTsKICAgICAgc2V0VmFsdWUoZWwsIHAudmFsdWUgPT0gbnVsbCA/ICIiIDogU3RyaW5nKHAudmFsdWUpKTsKICAgICAgYXdhaXQgc2xlZXAoNjApOwogICAgICByZXR1cm4geyBvazogdHJ1ZSwgdGFnOiBlbC50YWdOYW1lIH07CiAgICB9CiAgICBjYXNlICJzdG9yYWdlIjogewogICAgICBjb25zdCBvdXQgPSB7fTsKICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsb2NhbFN0b3JhZ2UubGVuZ3RoOyBpKyspIHsKICAgICAgICBjb25zdCBrID0gbG9jYWxTdG9yYWdlLmtleShpKTsKICAgICAgICBvdXRba10gPSBTdHJpbmcobG9jYWxTdG9yYWdlLmdldEl0ZW0oaykpLnNsaWNlKDAsIDMwMCk7CiAgICAgIH0KICAgICAgcmV0dXJuIHsga2V5czogT2JqZWN0LmtleXMob3V0KSwgZGF0YTogb3V0IH07CiAgICB9CiAgICBjYXNlICJhcGkiOiB7CiAgICAgIGNvbnN0IHIgPSBhd2FpdCBjaHJvbWUucnVudGltZS5zZW5kTWVzc2FnZSh7IHR5cGU6ICJhcGkiLCBwYXJhbXM6IHAgfSk7CiAgICAgIHJldHVybiByOwogICAgfQogICAgY2FzZSAiY29va2llIjoKICAgICAgcmV0dXJuIHsgY29va2llOiBkb2N1bWVudC5jb29raWUgfTsKICAgIGNhc2UgImZldGNoIjogewogICAgICBjb25zdCBpbml0ID0geyBtZXRob2Q6IHAubWV0aG9kIHx8ICJHRVQiLCBoZWFkZXJzOiBPYmplY3QuYXNzaWduKHt9LCBwLmhlYWRlcnMgfHwge30pLCBjcmVkZW50aWFsczogImluY2x1ZGUiLCBjYWNoZTogIm5vLXN0b3JlIiB9OwogICAgICBpZiAocC5ib2R5ICE9IG51bGwpIGluaXQuYm9keSA9IHR5cGVvZiBwLmJvZHkgPT09ICJzdHJpbmciID8gcC5ib2R5IDogSlNPTi5zdHJpbmdpZnkocC5ib2R5KTsKICAgICAgY29uc3QgciA9IGF3YWl0IGZldGNoKHAudXJsLCBpbml0KTsKICAgICAgY29uc3QgdGV4dCA9IGF3YWl0IHIudGV4dCgpOwogICAgICBsZXQgZGF0YSA9IG51bGw7CiAgICAgIHRyeSB7IGRhdGEgPSBKU09OLnBhcnNlKHRleHQpOyB9IGNhdGNoIChlKSB7IGRhdGEgPSB0ZXh0LnNsaWNlKDAsIDEyMDApOyB9CiAgICAgIHJldHVybiB7IG9rOiByLm9rLCBzdGF0dXM6IHIuc3RhdHVzLCBkYXRhIH07CiAgICB9CiAgICBjYXNlICJvcGVuIjogewogICAgICBjb25zdCByID0gYXdhaXQgY2hyb21lLnJ1bnRpbWUuc2VuZE1lc3NhZ2UoeyB0eXBlOiAib3BlbiIsIHBhcmFtczogcCB9KTsKICAgICAgcmV0dXJuIHI7CiAgICB9CiAgICBjYXNlICJ0YWJzIjogewogICAgICBjb25zdCByID0gYXdhaXQgY2hyb21lLnJ1bnRpbWUuc2VuZE1lc3NhZ2UoeyB0eXBlOiAidGFicyIgfSk7CiAgICAgIHJldHVybiByOwogICAgfQogICAgY2FzZSAiYXR0YWNoIjogewogICAgICBjb25zdCBsaXN0ID0gKHAuZmlsZXMgfHwgW10pLm1hcCgoZikgPT4gbmV3IEZpbGUoCiAgICAgICAgW2YuY29udGVudCA9PSBudWxsID8gIiIgOiBTdHJpbmcoZi5jb250ZW50KV0sCiAgICAgICAgZi5uYW1lLAogICAgICAgIHsgdHlwZTogZi50eXBlIHx8ICJ0ZXh0L3BsYWluIiB9CiAgICAgICkpOwogICAgICBpZiAoIWxpc3QubGVuZ3RoKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAibm8gZmlsZXMiIH07CiAgICAgIGNvbnN0IGR0ID0gbmV3IERhdGFUcmFuc2ZlcigpOwogICAgICBmb3IgKGNvbnN0IGYgb2YgbGlzdCkgZHQuaXRlbXMuYWRkKGYpOwogICAgICBjb25zdCBpbnB1dCA9IHAuc2VsZWN0b3IgPyBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKHAuc2VsZWN0b3IpIDogZG9jdW1lbnQucXVlcnlTZWxlY3RvcignaW5wdXRbdHlwZT1maWxlXScpOwogICAgICBpZiAoIWlucHV0KSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAiZmlsZSBpbnB1dCBub3QgZm91bmQiIH07CiAgICAgIGlucHV0LmZpbGVzID0gZHQuZmlsZXM7CiAgICAgIGlucHV0LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCJpbnB1dCIsIHsgYnViYmxlczogdHJ1ZSB9KSk7CiAgICAgIGlucHV0LmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCJjaGFuZ2UiLCB7IGJ1YmJsZXM6IHRydWUgfSkpOwogICAgICByZXR1cm4geyBvazogdHJ1ZSwgY291bnQ6IGxpc3QubGVuZ3RoLCBuYW1lczogbGlzdC5tYXAoKGYpID0+IGYubmFtZSkgfTsKICAgIH0KICAgIGNhc2UgInF1ZXJ5IjoKICAgICAgcmV0dXJuIHsgbGlzdDogcXVlcnlBbGwocC5zZWxlY3RvciB8fCAiKiIsIHAubGltaXQpIH07CiAgICBjYXNlICJjb3VudCI6CiAgICAgIHJldHVybiB7IG46IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwocC5zZWxlY3RvciB8fCAiKiIpLmxlbmd0aCB9OwogICAgY2FzZSAicmVjdCI6IHsKICAgICAgY29uc3QgZWwgPSByZXNvbHZlKHApOwogICAgICBpZiAoIWVsKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAibm90IGZvdW5kIiB9OwogICAgICBjb25zdCByID0gZWwuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7CiAgICAgIHJldHVybiB7IG9rOiB0cnVlLCB4OiByLmxlZnQsIHk6IHIudG9wLCB3OiByLndpZHRoLCBoOiByLmhlaWdodCB9OwogICAgfQogICAgZGVmYXVsdDoKICAgICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogInVua25vd24gYWN0aW9uOiAiICsgY21kLmFjdGlvbiB9OwogIH0KfQoKYXN5bmMgZnVuY3Rpb24gdGljaygpIHsKICBpZiAoYnVzeSkgcmV0dXJuOwogIGJ1c3kgPSB0cnVlOwogIHRyeSB7CiAgICBjb25zdCBjbWQgPSBhd2FpdCBjaHJvbWUucnVudGltZS5zZW5kTWVzc2FnZSh7IHR5cGU6ICJwb2xsIiwgdXJsOiBsb2NhdGlvbi5ocmVmIH0pOwogICAgaWYgKGNtZCAmJiBjbWQuaWQpIHsKICAgICAgbGV0IHJlc3VsdCA9IG51bGwsIGVycm9yID0gbnVsbDsKICAgICAgdHJ5IHsgcmVzdWx0ID0gYXdhaXQgcnVuKGNtZCk7IH0gY2F0Y2ggKGUpIHsgZXJyb3IgPSBTdHJpbmcoKGUgJiYgZS5tZXNzYWdlKSB8fCBlKTsgfQogICAgICBhd2FpdCBjaHJvbWUucnVudGltZS5zZW5kTWVzc2FnZSh7IHR5cGU6ICJyZXN1bHQiLCBpZDogY21kLmlkLCByZXN1bHQsIGVycm9yIH0pOwogICAgfQogIH0gY2F0Y2ggKGUpIHsKICB9IGZpbmFsbHkgeyBidXN5ID0gZmFsc2U7IH0KfQpzZXRJbnRlcnZhbCh0aWNrLCA4MDApOwp0aWNrKCk7Cg==',
};
const EXT_FILES = Object.keys(EXT);

const QUEUE = [];
const RESULTS = new Map();
const CLIENTS = [];
let counter = 0;
let server = null;

function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Length': body.length,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function takeCommand(pageUrl) {
  for (let i = 0; i < QUEUE.length; i += 1) {
    const item = QUEUE[i];
    const target = item.target || '';
    if (!target || String(pageUrl || '').includes(target)) {
      QUEUE.splice(i, 1);
      return item;
    }
  }
  return { id: null };
}

function extFile(file) {
  if (!EXT_FILES.includes(file)) return null;
  return Buffer.from(EXT[file], 'base64');
}

function handler(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1:' + PORT);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/cmd') {
    return json(res, 200, takeCommand(url.searchParams.get('u')));
  }
  if (req.method === 'GET' && url.pathname === '/get') {
    const id = url.searchParams.get('id') || '';
    const hit = RESULTS.get(id);
    if (hit) { RESULTS.delete(id); return json(res, 200, hit); }
    return json(res, 200, { id, pending: true });
  }
  if (req.method === 'GET' && url.pathname === '/hello_list') {
    return json(res, 200, { clients: CLIENTS.slice(-5), queued: QUEUE.length });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/ext/')) {
    const buf = extFile(url.pathname.slice('/ext/'.length));
    if (!buf) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length });
    return res.end(buf);
  }
  if (req.method === 'GET' && url.pathname === '/') {
    const body = Buffer.from(
      '<meta charset="utf-8"><h1>DSHM Browser Bridge</h1>'
      + '<p>扩展文件：<a href="/ext/manifest.json">manifest.json</a> '
      + '<a href="/ext/bg.js">bg.js</a> <a href="/ext/cs.js">cs.js</a></p>', 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length });
    return res.end(body);
  }

  if (req.method === 'POST') {
    return readBody(req).then((data) => {
      if (url.pathname === '/enqueue') {
        counter += 1;
        const id = String(data.id || ('c' + counter));
        QUEUE.push({ id, action: data.action, params: data.params || {}, target: data.target || '' });
        return json(res, 200, { ok: true, id, queued: QUEUE.length });
      }
      if (url.pathname === '/result') {
        const id = String(data.id || '');
        RESULTS.set(id, { id, pending: false, result: data.result === undefined ? null : data.result, error: data.error === undefined ? null : data.error, client: data.client === undefined ? null : data.client });
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/hello') {
        CLIENTS.push({ client: data.client });
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    });
  }
  return json(res, 404, { error: 'not found' });
}

async function workspaceDir() {
  try {
    const home = process.env.DSHM_HOME || '';
    if (home) {
      const info = JSON.parse(await readFile(join(home, 'host-ready.json'), 'utf8'));
      if (info && typeof info.workspace === 'string' && info.workspace) return info.workspace;
    }
  } catch { /* 兜底用当前目录 */ }
  return process.cwd();
}

async function exportExtension() {
  const dir = join(await workspaceDir(), 'browser-bridge-extension');
  try {
    await mkdir(dir, { recursive: true });
    for (const file of EXT_FILES) await writeFile(join(dir, file), extFile(file));
    return dir;
  } catch {
    return '';
  }
}

function startServer() {
  if (server) return;
  server = http.createServer((req, res) => {
    try { handler(req, res); } catch (error) { json(res, 500, { error: String(error) }); }
  });
  server.on('error', () => { server = null; });
  server.listen(PORT, '127.0.0.1', () => {
    console.log('[dshm-browser-bridge] listening on 127.0.0.1:' + PORT);
  });
}

async function apply() {
  startServer();
  const dir = await exportExtension();
  if (dir) console.log('[dshm-browser-bridge] extension exported to ' + dir);
}

export { apply, name };
