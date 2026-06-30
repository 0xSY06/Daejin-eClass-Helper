// ==UserScript==
// @name         Daejin eClass Lecture Helper
// @namespace    local.daejin.eclass.helper
// @version      1.0.0
// @description  Helper for Daejin eClass course/viewer/CMS pages.
// @match        *://eclass.daejin.ac.kr/*
// @match        *://cms.daejin.ac.kr/*
// @license      MIT
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  var GLOBAL_KEY = "dj_eclass_helper_global";
  var FLOW_COURSE_KEY = "dj_eclass_helper_active_course_id";
  var globalState = readJson(GLOBAL_KEY, { activeCourseId: "" });
  var pageUrl = new URL(location.href);
  var courseIdFromUrl = location.pathname.indexOf("/course/view.php") !== -1 ? pageUrl.searchParams.get("id") : "";
  var COURSE_ID = courseIdFromUrl || inferCourseIdFromDocument() || readSessionCourseId() || "";

  if (COURSE_ID !== "global") {
    globalState.activeCourseId = COURSE_ID;
    writeJson(GLOBAL_KEY, globalState);
  }

  var STORAGE_PREFIX = "dj_eclass_helper_" + (COURSE_ID || "runtime");
  var QUEUE_KEY = STORAGE_PREFIX + "_queue";
  var STATE_KEY = STORAGE_PREFIX + "_state";
  var FLOW_KEY = STORAGE_PREFIX + "_flow_active";
  var DEFAULT_STATE = {
    stateVersion: 4,
    autoplay: true,
    autoOpenViewer: true,
    autoNext: true,
    autoResume: true,
    panelCollapsed: false
  };
  var state = Object.assign({}, DEFAULT_STATE, readJson(STATE_KEY, DEFAULT_STATE));

  if (state.stateVersion !== DEFAULT_STATE.stateVersion) {
    state.stateVersion = DEFAULT_STATE.stateVersion;
    state.autoOpenViewer = true;
    state.autoNext = true;
    state.autoResume = true;
    writeJson(STATE_KEY, state);
  }

  // 내부적으로 무음 기능 항상 강제 유지 (UI 제거됨)
  state.muted = true;

  if (!isAllowedPage()) return;

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {}
  }

  function syncAutoResumeFlag() {
    try {
      localStorage.setItem("dj_eclass_helper_auto_resume_flag", state.autoResume ? "1" : "0");
    } catch (error) {}
  }

  function syncStateToFrames() {
    var frames = document.querySelectorAll("iframe, frame");
    frames.forEach(function(f) {
      try {
        if (f.contentWindow) {
          f.contentWindow.postMessage({
            source: "dj-eclass-helper",
            type: "state-update",
            state: state
          }, "*");
        }
      } catch(e) {}
    });
  }

  function saveState() {
    writeJson(STATE_KEY, state);
    syncAutoResumeFlag();
    syncStateToFrames();
  }

  function readSessionCourseId() {
    try {
      return sessionStorage.getItem(FLOW_COURSE_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function inferCourseIdFromDocument() {
    var selectors = [
      'a[href*="/course/view.php?id="]',
      'link[href*="/course/view.php?id="]',
      'form[action*="/course/view.php?id="]'
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var elements = Array.from(document.querySelectorAll(selectors[i]));
      for (var j = 0; j < elements.length; j += 1) {
        var raw = elements[j].href || elements[j].action || "";
        var id = extractCourseId(raw);
        if (id) return id;
      }
    }

    var textCandidates = [
      document.body && document.body.innerHTML,
      document.referrer
    ];

    for (var k = 0; k < textCandidates.length; k += 1) {
      var found = extractCourseId(textCandidates[k] || "");
      if (found) return found;
    }

    return "";
  }

  function extractCourseId(value) {
    var match = String(value || "").match(/\/course\/view\.php\?id=(\d+)/);
    return match ? match[1] : "";
  }

  function getQueue() {
    return readJson(QUEUE_KEY, []);
  }

  function setQueue(queue) {
    writeJson(QUEUE_KEY, queue);
  }

  function markFlowActive() {
    try {
      sessionStorage.setItem(FLOW_KEY, "1");
      if (COURSE_ID) sessionStorage.setItem(FLOW_COURSE_KEY, COURSE_ID);
    } catch (error) {}
  }

  function flowActive() {
    try {
      return sessionStorage.getItem(FLOW_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function clearFlowActive() {
    try {
      sessionStorage.removeItem(FLOW_KEY);
    } catch (error) {}
  }

  function isAllowedPage() {
    if (location.hostname.indexOf("cms.daejin.ac.kr") !== -1) return true;
    if (location.hostname.indexOf("eclass.daejin.ac.kr") === -1) return false;
    
    var p = location.pathname;
    return p.indexOf("/course/view.php") !== -1 || p.indexOf("/mod/") !== -1;
  }

  function pageKind() {
    if (location.hostname.indexOf("cms.daejin.ac.kr") !== -1) return "cms";
    var p = location.pathname;
    if (p.indexOf("/course/view.php") !== -1 || p.indexOf("/index.php") !== -1) return "course";
    if (p.indexOf("viewer/default/") !== -1) return "viewer-frame";
    if (p.indexOf("viewer.php") !== -1) return "viewer";
    if (p.indexOf("view.php") !== -1) return "view";
    return "unknown";
  }

  function isCourseControlPage() {
    return location.hostname.indexOf("eclass.daejin.ac.kr") !== -1 && location.pathname.indexOf("/course/view.php") !== -1 && !!pageUrl.searchParams.get("id");
  }

  function isPlaybackSupportPage() {
    return pageKind() === "view" || pageKind() === "viewer" || pageKind() === "viewer-frame" || pageKind() === "cms";
  }

  function isPanelPage() {
    return isCourseControlPage() || (location.hostname.indexOf("eclass.daejin.ac.kr") !== -1 && location.pathname.indexOf("viewer.php") !== -1);
  }

  function cssText(styles) {
    return Object.keys(styles).map(function (key) {
      return key + ":" + styles[key];
    }).join(";");
  }

  var statusClearTimeoutId = null;

  function setStatus(message) {
    var status = document.querySelector("#dj-helper-status");
    if (status) {
      status.textContent = message;
      
      if (statusClearTimeoutId) clearTimeout(statusClearTimeoutId);
      
      statusClearTimeoutId = setTimeout(function () {
        if (status) status.textContent = "대기 중";
      }, 3000);
      
    } else {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            source: "dj-eclass-helper",
            type: "status-update",
            message: message
          }, "*");
        }
      } catch(e) {}
    }
  }

  function visible(el) {
    if (!el) return false;
    var style = getComputedStyle(el);
    var rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function activityContainer(anchor) {
    return (
      anchor.closest("li") ||
      anchor.closest(".activity") ||
      anchor.closest(".activityinstance") ||
      anchor.closest("[class*=activity]") ||
      anchor.parentElement
    );
  }

  function sectionNumberFor(anchor) {
    var section = anchor.closest("li.section[id^='section-']");
    if (!section) return null;
    var match = section.id.match(/^section-(\d+)$/);
    return match ? Number(match[1]) : null;
  }

  function sectionAttendanceMap() {
    var map = new Map();
    Array.from(document.querySelectorAll(".attendance .attendance_section")).forEach(function (item) {
      var text = (item.innerText || item.textContent || "").replace(/\s+/g, " ").trim();
      var match = text.match(/^(\d+)\s+(.+)$/);
      if (!match) return;
      map.set(Number(match[1]), match[2]);
    });
    return map;
  }

  function sectionAlreadyAttended(sectionNumber, attendanceMap) {
    if (!sectionNumber || !attendanceMap.has(sectionNumber)) return false;
    var status = String(attendanceMap.get(sectionNumber) || "");
    return status.indexOf("\ucd9c\uc11d") !== -1;
  }

  function activityDone(container) {
    if (!container) return false;
    var text = (container.innerText || container.textContent || "").replace(/\s+/g, " ").toLowerCase();
    var cls = String(container.className || "").toLowerCase();
    var attrs = Array.from(container.querySelectorAll("[aria-label], [title], img[alt]")).map(function (el) {
      return el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt") || "";
    }).join(" ").toLowerCase();
    var all = text + " " + cls + " " + attrs;

    var incomplete = [
      "not completed",
      "incomplete",
      "completion-n",
      "completion_incomplete",
      "\ubbf8\uc644\ub8cc",
      "\ubbf8\ucd9c\uc11d",
      "\ud559\uc2b5\uc804",
      "\uacb0\uc11d"
    ];
    var complete = [
      "completed",
      "completion-y",
      "completion_complete",
      "\uc644\ub8cc",
      "\ucd9c\uc11d\uc644\ub8cc",
      "\ud559\uc2b5\uc644\ub8cc",
      "\uc218\uac15\uc644\ub8cc",
      "\ucd9c\uc11d"
    ];

    if (incomplete.some(function (hint) { return all.indexOf(hint) !== -1; })) return false;
    return complete.some(function (hint) { return all.indexOf(hint) !== -1; });
  }

  function lectureTitle(anchor, container, index) {
    var raw =
      anchor.getAttribute("title") ||
      anchor.getAttribute("aria-label") ||
      anchor.innerText ||
      anchor.textContent ||
      (container && (container.innerText || container.textContent)) ||
      "Lecture " + (index + 1);
    return raw.replace(/\s+/g, " ").trim();
  }

  function lectureOrderKey(lecture, index) {
    var title = String(lecture.title || "");
    var match = title.match(/^\s*(\d{1,3})\s*[-_.]\s*(\d{1,3})/);
    if (match) return Number(match[1]) * 1000 + Number(match[2]);

    match = title.match(/^\s*(\d{1,3})\b/);
    if (match) return Number(match[1]) * 1000;

    return 1000000 + index;
  }

  function collectLectures() {
    refreshCourseIdFromPage();
    var attendanceMap = sectionAttendanceMap();

    var anchors = Array.from(document.querySelectorAll("a[href]")).filter(function (a) {
      var href = a.href;
      if (href.indexOf("/mod/") === -1) return false;
      if (!/(view|viewer)\.php/.test(href)) return false;
      
      var excludedModules = ["board", "forum", "ubboard", "assign", "quiz", "folder", "page", "resource", "label", "feedback"];
      for (var i = 0; i < excludedModules.length; i++) {
        if (href.indexOf("/mod/" + excludedModules[i] + "/") !== -1) {
          return false;
        }
      }
      return true;
    });

    var lectures = anchors.map(function (anchor, index) {
      var container = activityContainer(anchor);
      var sectionNumber = sectionNumberFor(anchor);
      
      var targetHref = anchor.href; 
      var onclickVal = anchor.getAttribute("onclick") || "";
      var viewerMatch = onclickVal.match(/window\.open\(['"]([^'"]+)['"]/);
      if (viewerMatch) {
        var url = viewerMatch[1];
        if (url.indexOf("http") !== 0 && url.indexOf("/") === 0) {
          url = location.origin + url;
        }
        targetHref = url; 
      }

      return {
        title: lectureTitle(anchor, container, index),
        href: targetHref,
        sectionNumber: sectionNumber,
        sectionStatus: sectionNumber ? attendanceMap.get(sectionNumber) || "" : "",
        completed: activityDone(container) || sectionAlreadyAttended(sectionNumber, attendanceMap)
      };
    });

    var uniqueMap = new Map();
    lectures.forEach(function (lecture) {
      if (!uniqueMap.has(lecture.href)) uniqueMap.set(lecture.href, lecture);
    });

    var unique = Array.from(uniqueMap.values()).sort(function (a, b) {
      return lectureOrderKey(a, 0) - lectureOrderKey(b, 0);
    });
    var unfinished = unique.filter(function (lecture) {
      return !lecture.completed;
    });

    setQueue(unfinished);
    renderQueue(unfinished);
    setStatus("목록 수집 완료: " + unfinished.length + "개");
    return unfinished;
  }

  function findSameOriginFrames() {
    var docs = [document];
    Array.from(document.querySelectorAll("iframe, frame")).forEach(function (frame) {
      try {
        if (frame.contentDocument) docs.push(frame.contentDocument);
      } catch (error) {}
    });
    return docs;
  }

  function mediaElements() {
    return findSameOriginFrames().flatMap(function (doc) {
      return Array.from(doc.querySelectorAll("video, audio"));
    });
  }

  function parseClock(value) {
    var parts = String(value || "").trim().split(":").map(function (part) {
      return Number(part);
    });
    if (!parts.length || parts.some(function (part) { return !Number.isFinite(part); })) return NaN;
    return parts.reduce(function (total, part) {
      return total * 60 + part;
    }, 0);
  }

  function controllerTimes() {
    return findSameOriginFrames().flatMap(function (doc) {
      return Array.from(doc.querySelectorAll(".vc-pctrl-play-time-text-area")).map(function (el) {
        var text = (el.innerText || el.textContent || "").trim();
        var match = text.match(/(\d{1,2}(?::\d{2}){1,2})\s*\/\s*(\d{1,2}(?::\d{2}){1,2})/);
        if (!match) return null;
        return {
          text: text,
          current: parseClock(match[1]),
          duration: parseClock(match[2])
        };
      }).filter(Boolean);
    });
  }

  var endHandledAt = 0;
  var realPlaybackSeen = false;

  function handlePlaybackEnd(source) {
    var now = Date.now();
    if (now - endHandledAt < 10000) return;
    endHandledAt = now;

    setStatus("재생 종료 감지. 3초 후 다음 강의로 이동합니다.");

    if (state.autoNext) {
      // 1.5초에서 3초로 넉넉하게 대기하여 서버 저장 시간 확보
      setTimeout(function () {
        requestNextLecture();
      }, 3000);
    }
  }

  function requestNextLecture() {
    if (location.hostname.indexOf("cms.daejin.ac.kr") !== -1) {
      try {
        top.postMessage({ source: "dj-eclass-helper", type: "open-next" }, "https://eclass.daejin.ac.kr");
      } catch (error) {}
      return;
    }
    openNextLecture();
  }

  function listenForFrameMessages() {
    window.addEventListener("message", function (event) {
      if (!event.data || event.data.source !== "dj-eclass-helper") return;
      
      if (event.data.type === "open-next" && state.autoNext) {
        if (location.hostname.indexOf("eclass.daejin.ac.kr") !== -1) {
          openNextLecture();
        }
      }
      
      if (event.data.type === "state-update") {
        Object.assign(state, event.data.state);
      }
      
      if (event.data.type === "status-update") {
        setStatus(event.data.message);
      }
    });
  }

  function mediaLooksLikeRealLecture(media) {
    if (!media || !Number.isFinite(media.duration)) return false;
    var src = String(media.currentSrc || media.src || "").toLowerCase();
    if (src.indexOf("preloader") !== -1) return false;
    return media.duration >= 60;
  }

  function mediaLooksEnded(media) {
    if (!mediaLooksLikeRealLecture(media)) return false;
    return media.ended || media.currentTime >= Math.max(0, media.duration - 2);
  }

  function watchPlaybackEnd() {
    mediaElements().forEach(function (media) {
      if (media.dataset.djEndWatcherAttached === "1") return;
      media.dataset.djEndWatcherAttached = "1";
      media.addEventListener("ended", function () {
        if (mediaLooksEnded(media)) handlePlaybackEnd("media");
      });
    });

    var times = controllerTimes();
    var realControllerTime = times.find(function (time) {
      return Number.isFinite(time.current) && Number.isFinite(time.duration) && time.duration >= 60;
    });

    if (realControllerTime && realControllerTime.current > 5) {
      realPlaybackSeen = true;
    }

    if (realPlaybackSeen && mediaElements().some(mediaLooksEnded)) {
      handlePlaybackEnd("media-time");
      return;
    }

    var endedByController = times.some(function (time) {
      return (
        realPlaybackSeen &&
        Number.isFinite(time.current) &&
        Number.isFinite(time.duration) &&
        time.duration >= 60 &&
        time.current >= time.duration - 2
      );
    });

    if (endedByController) {
      handlePlaybackEnd("controller");
    }
  }

  function injectMuteHijack() {
    try {
      var script = document.createElement("script");
      script.textContent = "(" + function () {
        window.__djMuted = true; 
        try {
          var origVol = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
          var origMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'muted');
          
          if (origVol && origMuted) {
            Object.defineProperty(HTMLMediaElement.prototype, 'volume', {
              get: function() { return origVol.get.call(this); },
              set: function(val) { origVol.set.call(this, 0); } 
            });
            
            Object.defineProperty(HTMLMediaElement.prototype, 'muted', {
              get: function() { return origMuted.get.call(this); },
              set: function(val) { origMuted.set.call(this, true); } 
            });
          }
        } catch (e) {}
      }.toString() + ")();";
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {}
  }

  function applyMuteState() {
    var count = 0;
    var items = mediaElements();
    items.forEach(function (media) {
      if (!media.muted || media.volume > 0) {
        media.muted = true;
        media.volume = 0;
        if (!media.hasAttribute("muted")) media.setAttribute("muted", "true");
        try { media.dispatchEvent(new Event("volumechange")); } catch(e){}
        count++;
      }
    });
    return count;
  }

  function candidateButtons() {
    var selectors = [
      ".vc-front-screen-play-btn",
      ".vc-front-mixed-play-btn",
      ".vc-front-multi-play-btn",
      ".vc-pctrl-play-pause-btn.vc-pctrl-on-pause",
      ".player-restart-btn",
      ".vjs-play-control",
      ".vjs-big-play-button",
      ".jw-icon-playback",
      ".plyr__control[data-plyr=play]",
      ".mejs-playpause-button button",
      "[class*='play-btn']",
      "[class*='play-pause']",
      "[class*=play][role=button]",
      "button[aria-label*='Play' i]",
      "button[title*='Play' i]",
      "button[aria-label*='재생']",
      "button[title*='재생']",
      "a[aria-label*='Play' i]",
      "a[title*='Play' i]",
      "button[aria-label*='\uc7ac\uc0dd']",
      "button[title*='\uc7ac\uc0dd']",
      "a[aria-label*='\uc7ac\uc0dd']",
      "a[title*='\uc7ac\uc0dd']"
    ];

    return findSameOriginFrames().flatMap(function (doc) {
      return selectors.flatMap(function (selector) {
        try {
          return Array.from(doc.querySelectorAll(selector));
        } catch (error) {
          return [];
        }
      });
    });
  }

  function clickPlayButton() {
    var buttons = candidateButtons();
    for (var i = 0; i < buttons.length; i += 1) {
      var className = String(buttons[i].className || "");
      if (className.indexOf("vc-pctrl-on-playing") !== -1) continue;
      if (visible(buttons[i])) {
        buttons[i].click();
        return true;
      }
    }
    return false;
  }

  async function playCurrentMedia(isManual) {
    var manual = (isManual === true || (isManual && isManual.type === "click"));

    if (isCourseControlPage()) {
      if (!getQueue().length) collectLectures();
      openNextLecture();
      return true;
    }

    if (!isPlaybackSupportPage()) {
      if (manual) setStatus("재생은 뷰어/플레이어 페이지에서만 동작합니다");
      return false;
    }

    var docs = findSameOriginFrames();
    var uiPlaying = false;
    for (var d = 0; d < docs.length; d++) {
      try {
        if (docs[d].querySelector(".vc-pctrl-on-playing, .vjs-playing, .plyr--playing, .jw-state-playing")) {
          uiPlaying = true;
          break;
        }
      } catch (e) {}
    }

    if (uiPlaying || mediaElements().some(function (media) {
      return !media.paused && !media.ended;
    })) {
      setStatus("이미 재생 중입니다");
      return true;
    }

    if (clickPlayButton()) {
      setStatus("재생 버튼을 눌렀습니다");
      return true;
    }

    var items = mediaElements();
    for (var i = 0; i < items.length; i += 1) {
      var media = items[i];
      try {
        media.playsInline = true;
        var playPromise = media.play();
        if (playPromise !== undefined) {
          await playPromise.catch(function(error) {}); 
        }
        setStatus("영상을 재생했습니다");
        return true;
      } catch (error) {}
    }

    if (manual) {
      setStatus("재생할 영상/버튼을 찾지 못했습니다");
    }
    return false;
  }

  // 화면 이탈 시 뜨는 성가신 팝업(beforeunload)을 지속적으로 무력화하는 기능
  function removeUnloadBlocker() {
    try {
      var script = document.createElement("script");
      script.textContent = "(" + function () {
        window.onbeforeunload = null;
        if (typeof window.jQuery !== 'undefined') {
          window.jQuery(window).off('beforeunload');
        }
      }.toString() + ")();";
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {}
  }

  function viewerLinks() {
    var links = [];
    Array.from(document.querySelectorAll("a[href], iframe[src], frame[src]")).forEach(function (el) {
      if (el.href) links.push(el.href);
      if (el.src) links.push(el.src);
    });

    Array.from(document.querySelectorAll("[onclick]")).forEach(function(el) {
      var match = String(el.getAttribute("onclick")).match(/window\.open\(['"]([^'"]+)['"]/);
      if (match) {
        var url = match[1];
        if (url.indexOf("http") !== 0 && url.indexOf("/") === 0) {
          url = location.origin + url;
        }
        links.push(url);
      }
    });

    return Array.from(new Set(links)).filter(function (href) {
      return (
        /\/mod\/[^/]+\/viewer\.php/.test(href) ||
        /\/mod\/[^/]+\/viewer\/default\//.test(href) ||
        /^https:\/\/cms\.daejin\.ac\.kr\/em\//.test(href)
      );
    });
  }

  function openViewer() {
    if (isCourseControlPage()) {
      if (!getQueue().length) collectLectures();
      openNextLecture();
      return true;
    }

    var links = viewerLinks();
    if (links.length) {
      setStatus("뷰어를 여는 중");
      removeUnloadBlocker(); 
      location.href = links[0];
      return true;
    }
    setStatus("뷰어 링크를 찾지 못했습니다");
    return false;
  }

  function openNextLecture() {
    var queue = getQueue();
    if (!queue.length) {
      setStatus("강의 목록이 비어 있습니다");
      return;
    }
    var next = queue.shift();
    setQueue(queue);
    renderQueue(queue);
    setStatus("다음 강의로 이동 중");
    markFlowActive();
    removeUnloadBlocker(); 
    location.href = next.href; 
  }

  function refreshCourseIdFromPage() {
    var id = inferCourseIdFromDocument();
    if (!id || id === COURSE_ID) return;

    COURSE_ID = id;
    STORAGE_PREFIX = "dj_eclass_helper_" + COURSE_ID;
    QUEUE_KEY = STORAGE_PREFIX + "_queue";
    STATE_KEY = STORAGE_PREFIX + "_state";
    FLOW_KEY = STORAGE_PREFIX + "_flow_active";
    globalState.activeCourseId = COURSE_ID;
    writeJson(GLOBAL_KEY, globalState);
    try {
      sessionStorage.setItem(FLOW_COURSE_KEY, COURSE_ID);
    } catch (error) {}
  }

  function clearQueue() {
    setQueue([]);
    renderQueue([]);
    setStatus("목록을 비웠습니다");
  }

  function stopAutomation() {
    state.autoplay = false;
    state.autoOpenViewer = false;
    state.autoNext = false;
    state.autoResume = false;
    saveState();
    clearFlowActive();

    var autoplay = document.querySelector("#dj-helper-autoplay");
    var autoViewer = document.querySelector("#dj-helper-auto-viewer");
    var autoNext = document.querySelector("#dj-helper-auto-next");
    var autoResume = document.querySelector("#dj-helper-auto-resume");
    if (autoplay) autoplay.checked = false;
    if (autoViewer) autoViewer.checked = false;
    if (autoNext) autoNext.checked = false;
    if (autoResume) autoResume.checked = false;

    setStatus("자동 진행을 중지했습니다");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderQueue(queue) {
    queue = queue || getQueue();
    var list = document.querySelector("#dj-helper-list");
    if (!list) return;

    if (!queue.length) {
      list.innerHTML = '<div style="color:#aaa;">저장된 강의 목록이 없습니다.</div>';
      return;
    }

    list.innerHTML = queue.slice(0, 4).map(function (lecture, index) {
      var title = escapeHtml(lecture.title || "Lecture " + (index + 1));
      return '<button data-dj-open="' + index + '" title="' + title + '" style="' + cssText({
        width: "100%",
        display: "block",
        margin: "4px 0",
        padding: "6px 7px",
        border: "1px solid #3f3f46",
        "border-radius": "6px",
        background: "#27272a",
        color: "#fff",
        "text-align": "left",
        "font-size": "12px",
        cursor: "pointer",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "white-space": "nowrap"
      }) + '">' + title + '</button>';
    }).join("");

    if (queue.length > 4) {
      list.insertAdjacentHTML("beforeend", '<div style="color:#aaa;margin-top:4px;">외 ' + (queue.length - 4) + "개</div>");
    }

    Array.from(list.querySelectorAll("[data-dj-open]")).forEach(function (button) {
      button.addEventListener("click", function () {
        var index = Number(button.getAttribute("data-dj-open"));
        var target = getQueue()[index];
        if (target) {
          markFlowActive();
          removeUnloadBlocker();
          location.href = target.href;
        }
      });
    });
  }

  function addButtonStyles(panel) {
    Array.from(panel.querySelectorAll("button")).forEach(function (button) {
      if (button.id === "dj-helper-collapse") return;
      button.style.fontFamily = "inherit";
      button.style.fontSize = "12px";
      button.style.border = "1px solid #3f3f46";
      button.style.borderRadius = "6px";
      button.style.background = "#27272a";
      button.style.color = "#fff";
      button.style.padding = "7px";
      button.style.cursor = "pointer";
    });
  }

  function createPanel() {
    if (!isPanelPage()) return;
    if (!document.body || document.querySelector("#dj-helper-panel")) return;

    var panel = document.createElement("div");
    panel.id = "dj-helper-panel";
    panel.style.cssText = cssText({
      position: "fixed",
      right: "18px",
      bottom: "18px",
      "z-index": "2147483647",
      width: "300px",
      padding: "12px",
      border: "1px solid #27272a",
      "border-radius": "8px",
      background: "#18181b",
      color: "#fff",
      "font-family": "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      "font-size": "13px",
      "line-height": "1.4",
      "box-shadow": "0 10px 30px rgba(0,0,0,.35)"
    });

    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
      '<strong>eClass Helper</strong>' +
      '<button id="dj-helper-collapse" title="접기" style="background:transparent;border:none;color:#fff;cursor:pointer;font-size:16px;">-</button>' +
      "</div>" +
      '<div id="dj-helper-body">' +
      '<div style="margin-bottom:6px;color:#aaa;">강의실 ' + escapeHtml(COURSE_ID) + "</div>" +
      '<div id="dj-helper-status" style="min-height:18px;margin-bottom:10px;color:#ddd;">대기 중</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">' +
      '<button id="dj-helper-scan">목록 수집</button>' +
      '<button id="dj-helper-next">다음 강의</button>' +
      '<button id="dj-helper-play">재생 시작</button>' +
      '<button id="dj-helper-clear">목록 비움</button>' +
      '<button id="dj-helper-stop" style="grid-column: span 2;">자동 중지</button>' +
      "</div>" +
      '<label style="display:flex;align-items:center;gap:7px;margin:8px 0 6px;"><input id="dj-helper-autoplay" type="checkbox">페이지 진입 시 재생</label>' +
      '<label style="display:flex;align-items:center;gap:7px;margin:0 0 6px;"><input id="dj-helper-auto-viewer" type="checkbox">강의 뷰어 자동 열기</label>' +
      '<label style="display:flex;align-items:center;gap:7px;margin:0 0 6px;"><input id="dj-helper-auto-resume" type="checkbox">이어보기 자동 확인</label>' +
      '<label style="display:flex;align-items:center;gap:7px;margin:0 0 10px;"><input id="dj-helper-auto-next" type="checkbox">끝나면 다음 강의로 이동</label>' +
      '<div id="dj-helper-list" style="max-height:130px;overflow:auto;border-top:1px solid #27272a;padding-top:8px;"></div>' +
      "</div>";

    document.body.appendChild(panel);
    addButtonStyles(panel);

    var autoplayCheck = panel.querySelector("#dj-helper-autoplay");
    var autoViewerCheck = panel.querySelector("#dj-helper-auto-viewer");
    var autoNextCheck = panel.querySelector("#dj-helper-auto-next");
    var autoResumeCheck = panel.querySelector("#dj-helper-auto-resume");

    if (autoplayCheck) autoplayCheck.checked = state.autoplay;
    if (autoViewerCheck) autoViewerCheck.checked = state.autoOpenViewer;
    if (autoNextCheck) autoNextCheck.checked = state.autoNext;
    if (autoResumeCheck) autoResumeCheck.checked = state.autoResume;

    if (autoplayCheck) {
      autoplayCheck.addEventListener("change", function (event) {
        state.autoplay = event.target.checked;
        saveState();
        setStatus(state.autoplay ? "자동 재생 NO" : "자동 재생 OFF");
      });
    }
    
    if (autoViewerCheck) {
      autoViewerCheck.addEventListener("change", function (event) {
        state.autoOpenViewer = event.target.checked;
        saveState();
        setStatus(state.autoOpenViewer ? "뷰어 자동 열기 ON" : "뷰어 자동 열기 OFF");
      });
    }

    if (autoNextCheck) {
      autoNextCheck.addEventListener("change", function (event) {
        state.autoNext = event.target.checked;
        saveState();
        setStatus(state.autoNext ? "끝나면 다음 이동 ON" : "끝나면 다음 이동 OFF");
      });
    }

    if (autoResumeCheck) {
      autoResumeCheck.addEventListener("change", function (event) {
        state.autoResume = event.target.checked;
        saveState();
        setStatus(state.autoResume ? "이어보기 자동 수락 ON" : "이어보기 자동 수락 OFF");
      });
    }

    panel.querySelector("#dj-helper-scan").addEventListener("click", collectLectures);
    panel.querySelector("#dj-helper-next").addEventListener("click", openNextLecture);
    panel.querySelector("#dj-helper-play").addEventListener("click", function() {
      playCurrentMedia(true);
    });
    panel.querySelector("#dj-helper-clear").addEventListener("click", clearQueue);
    panel.querySelector("#dj-helper-stop").addEventListener("click", stopAutomation);
    panel.querySelector("#dj-helper-collapse").addEventListener("click", function () {
      state.panelCollapsed = !state.panelCollapsed;
      saveState();
      applyCollapsedState();
    });

    renderQueue();
    applyCollapsedState();
  }

  function applyCollapsedState() {
    var body = document.querySelector("#dj-helper-body");
    var button = document.querySelector("#dj-helper-collapse");
    if (!body || !button) return;
    body.style.display = state.panelCollapsed ? "none" : "block";
    button.textContent = state.panelCollapsed ? "+" : "-";
    button.title = state.panelCollapsed ? "펼치기" : "접기";
  }

  function checkResumePrompt() {
    if (!state.autoResume) return;
    var docs = findSameOriginFrames();
    for (var i = 0; i < docs.length; i++) {
      var doc = docs[i];
      try {
        var buttons = Array.from(doc.querySelectorAll("button, a, div[role='button']"));
        for (var j = 0; j < buttons.length; j++) {
          var btn = buttons[j];
          if (!visible(btn)) continue;
          var btnText = (btn.innerText || btn.textContent || "").trim();
          if (btnText === "예" || btnText === "확인" || btnText === "Yes" || btnText === "OK") {
            var container = btn.closest("div, .modal, .alert, .popup, .confirm") || doc.body;
            var containerText = (container.innerText || container.textContent || "").replace(/\s+/g, "");
            if (containerText.indexOf("이전시청기록") !== -1 || 
                containerText.indexOf("이어서보시겠습니까") !== -1 || 
                containerText.indexOf("이전학습") !== -1 ||
                containerText.indexOf("이어보기") !== -1) {
              btn.click();
              setStatus("이어보기 알림 수락");
              return;
            }
          }
        }
      } catch (e) {}
    }
  }

  function injectConfirmOverride() {
    try {
      var script = document.createElement("script");
      script.textContent = "(" + function () {
        var _confirm = window.confirm;
        window.confirm = function (msg) {
          var autoResume = localStorage.getItem("dj_eclass_helper_auto_resume_flag") === "1";
          if (autoResume && msg && (msg.indexOf("이전") !== -1 || msg.indexOf("기록") !== -1 || msg.indexOf("이어") !== -1)) {
            return true;
          }
          return _confirm(msg);
        };
      }.toString() + ")();";
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (e) {}
  }

  function startObservers() {
    setInterval(function () {
      applyMuteState();
    }, 300);

    setInterval(function () {
      watchPlaybackEnd();
      checkResumePrompt(); 
      removeUnloadBlocker(); // 1.5초마다 지속적으로 이탈 방지 팝업을 파괴하여 안전하게 다음 이동 준비
    }, 1500);
  }

  function init() {
    syncAutoResumeFlag();
    injectConfirmOverride();
    injectMuteHijack(); 
    listenForFrameMessages();
    createPanel();
    startObservers();
    applyMuteState();

    if (isCourseControlPage()) {
      clearFlowActive();
      collectLectures();
    } else if (pageKind() === "view") {
      if (state.autoOpenViewer) setTimeout(openViewer, 1000);
    } else if (pageKind() === "viewer-frame") {
      if (state.autoOpenViewer) setTimeout(openViewer, 1000);
    } else if (pageKind() === "viewer" || pageKind() === "cms") {
      if (state.autoplay) {
        setTimeout(function() { playCurrentMedia(false); }, 800);
        setTimeout(function() { playCurrentMedia(false); }, 2500);
        setTimeout(function() { playCurrentMedia(false); }, 5000);
      }
    } else {
      setStatus("Ready");
    }
  }

  if (document.body) {
    init();
  } else {
    window.addEventListener("DOMContentLoaded", init, { once: true });
  }
})();
