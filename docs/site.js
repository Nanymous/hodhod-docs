(function () {
  "use strict";

  var root = document.documentElement;
  var body = document.body;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var themeToggle = document.querySelector(".theme-toggle");
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  var progressBar = document.getElementById("progress-bar");
  var backToTop = document.querySelector(".back-to-top");
  var toast = document.getElementById("toast");
  var toastTimer = null;
  var searchDialog = document.getElementById("search-dialog");
  var searchInput = document.getElementById("search-input");
  var searchResults = document.getElementById("search-results");
  var searchTrigger = document.querySelector(".search-trigger");
  var searchClose = document.querySelector("[data-close-search]");
  var navDialog = document.getElementById("nav-dialog");
  var navTrigger = document.querySelector(".menu-toggle");
  var navClose = document.querySelector("[data-close-nav]");
  var sidebarLinks = Array.prototype.slice.call(document.querySelectorAll(".sidebar-link"));
  var sections = Array.prototype.slice.call(document.querySelectorAll("main section[id]"));
  var searchIndex = [];
  var selectedResult = 0;
  var filteredResults = [];

  function getSectionEntries() {
    return sections.map(function (section) {
      return {
        id: section.id,
        title: section.dataset.title || section.id,
        kicker: section.dataset.kicker || "Hodhod docs",
        text: section.dataset.search || "",
        element: section
      };
    });
  }

  searchIndex = getSectionEntries();

  function setTheme(theme, persist) {
    root.dataset.theme = theme;
    var isLight = theme === "light";
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", String(isLight));
      themeToggle.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
    }
    if (metaTheme) {
      var bg = getComputedStyle(root).getPropertyValue("--bg").trim();
      if (bg) metaTheme.setAttribute("content", bg);
    }
    if (persist) {
      try {
        localStorage.setItem("hh-theme", theme);
      } catch (error) {}
    }
  }

  setTheme(root.dataset.theme === "light" ? "light" : "dark", false);

  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      setTheme(root.dataset.theme === "light" ? "dark" : "light", true);
    });
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 1800);
  }

  function copyText(text, button) {
    var done = function () {
      var label = button.querySelector("span");
      var original = label ? label.textContent : "";
      button.classList.add("is-copied");
      if (label) label.textContent = "Copied";
      showToast("Copied to clipboard");
      window.setTimeout(function () {
        button.classList.remove("is-copied");
        if (label) label.textContent = original;
      }, 1600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        showToast("Copy failed");
      });
      return;
    }

    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
      done();
    } catch (error) {
      showToast("Copy failed");
    }
    document.body.removeChild(area);
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (button) {
    button.addEventListener("click", function () {
      var shell = button.closest("[data-code]");
      var code = shell ? shell.querySelector("pre code") : null;
      if (code) copyText(code.innerText, button);
    });
  });

  function updateScrollState() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    if (progressBar) progressBar.style.width = (progress * 100).toFixed(2) + "%";
    if (backToTop) backToTop.classList.toggle("is-visible", window.scrollY > 560);

    var current = sections[0];
    var marker = window.scrollY + 150;
    sections.forEach(function (section) {
      if (section.offsetTop <= marker) current = section;
    });
    if (current) {
      sidebarLinks.forEach(function (link) {
        var active = link.dataset.section === current.id;
        link.classList.toggle("is-active", active);
        if (active) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }
  }

  var scrollQueued = false;
  window.addEventListener("scroll", function () {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(function () {
      updateScrollState();
      scrollQueued = false;
    });
  }, { passive: true });

  updateScrollState();

  if (backToTop) {
    backToTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? "auto" : "smooth" });
    });
  }

  function openSearch() {
    if (!searchDialog) return;
    if (searchDialog.open) {
      searchDialog.close();
      return;
    }
    searchDialog.showModal();
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    renderSearch("");
  }

  function closeSearch() {
    if (searchDialog && searchDialog.open) searchDialog.close();
  }

  if (searchTrigger) searchTrigger.addEventListener("click", openSearch);
  if (searchClose) searchClose.addEventListener("click", closeSearch);

  function renderSearch(query) {
    if (!searchResults) return;
    var needle = query.trim().toLowerCase();
    filteredResults = searchIndex.filter(function (entry) {
      if (!needle) return true;
      return (entry.title + " " + entry.kicker + " " + entry.text).toLowerCase().indexOf(needle) !== -1;
    });

    searchResults.innerHTML = "";
    selectedResult = 0;

    if (!filteredResults.length) {
      var empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "No documentation matches that search.";
      searchResults.appendChild(empty);
      return;
    }

    filteredResults.forEach(function (entry, index) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "search-result" + (index === 0 ? " is-selected" : "");
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", index === 0 ? "true" : "false");
      button.dataset.id = entry.id;

      var kicker = document.createElement("span");
      kicker.className = "result-kicker";
      kicker.textContent = entry.kicker;

      var title = document.createElement("span");
      title.className = "result-title";
      title.textContent = entry.title;

      var copy = document.createElement("span");
      copy.className = "result-copy";
      copy.textContent = entry.text;

      button.appendChild(kicker);
      button.appendChild(title);
      button.appendChild(copy);

      button.addEventListener("click", function () {
        goToSection(entry.id);
      });

      searchResults.appendChild(button);
    });
  }

  function goToSection(id) {
    closeSearch();
    var target = document.getElementById(id);
    if (!target) return;
    if (window.location.hash !== "#" + id) {
      window.history.pushState(null, "", "#" + id);
    }
    target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  function moveSelection(direction) {
    if (!filteredResults.length) return;
    selectedResult = (selectedResult + direction + filteredResults.length) % filteredResults.length;
    Array.prototype.forEach.call(searchResults.querySelectorAll(".search-result"), function (button, index) {
      var selected = index === selectedResult;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", String(selected));
      if (selected) button.scrollIntoView({ block: "nearest" });
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      renderSearch(searchInput.value);
    });
    searchInput.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (filteredResults[selectedResult]) goToSection(filteredResults[selectedResult].id);
      }
    });
  }

  if (searchResults) {
    searchResults.setAttribute("role", "listbox");
    searchResults.setAttribute("aria-label", "Documentation results");
  }

  function openNav() {
    if (!navDialog) return;
    navDialog.showModal();
  }

  function closeNav() {
    if (navDialog && navDialog.open) navDialog.close();
  }

  if (navTrigger) navTrigger.addEventListener("click", openNav);
  if (navClose) navClose.addEventListener("click", closeNav);

  Array.prototype.forEach.call(document.querySelectorAll(".mobile-nav a, .mobile-nav-links a"), function (link) {
    link.addEventListener("click", function () {
      closeNav();
    });
  });

  [searchDialog, navDialog].forEach(function (dialog) {
    if (!dialog) return;
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
  });

  document.addEventListener("keydown", function (event) {
    var target = event.target;
    var isTyping = target && (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable
    );

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
      return;
    }

    if (event.key === "/" && !isTyping && !searchDialog.open && !navDialog.open) {
      event.preventDefault();
      openSearch();
    }
  });

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function (event) {
      var hash = link.getAttribute("href");
      if (!hash || hash === "#") return;
      var target = document.querySelector(hash);
      if (!target) return;
      event.preventDefault();
      history.pushState(null, "", hash);
      target.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    });
  });

  if (window.location.hash) {
    var initial = document.querySelector(window.location.hash);
    if (initial) window.setTimeout(function () {
      initial.scrollIntoView({ behavior: "auto", block: "start" });
    }, 0);
  }

  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", updateScrollState);
  }
})();
