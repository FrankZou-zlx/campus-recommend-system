/* ===========================================================
   作品集站点交互：移动端菜单 + 导航高亮 + 数字滚动
   零依赖原生 JS，无需构建
   =========================================================== */
(function () {
  'use strict';

  /* ---------- 1. 移动端汉堡菜单 ---------- */
  var btn = document.getElementById('menuBtn');
  var links = document.getElementById('navLinks');

  if (btn && links) {
    btn.addEventListener('click', function () {
      links.classList.toggle('open');
    });
    // 点击任一导航项后自动收起（移动端体验）
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') links.classList.remove('open');
    });
  }

  /* ---------- 2. 滚动时高亮当前区块 ---------- */
  var anchors = Array.prototype.slice.call(
    document.querySelectorAll('.nav-links a[href^="#"]')
  );
  var sections = anchors
    .map(function (a) {
      return document.querySelector(a.getAttribute('href'));
    })
    .filter(Boolean);

  function highlight() {
    // 导航高度 + 容差
    var offset = 96;
    var idx = -1;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top - offset <= 0) idx = i;
    }
    anchors.forEach(function (a, i) {
      a.classList.toggle('active', i === idx);
    });
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      highlight();
      ticking = false;
    });
  }, { passive: true });

  /* ---------- 3. 数字滚动动画（进入视口时触发一次） ---------- */
  var counters = Array.prototype.slice.call(
    document.querySelectorAll('.stat b, .hero-facts b')
  );

  function animateCount(el) {
    var raw = el.textContent.trim();
    var target = parseInt(raw, 10);
    // 非纯数字（如 18000 之外的占位文本）跳过
    if (isNaN(target) || String(target) !== raw) return;

    var dur = 900;
    var start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      // easeOutCubic
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased);
      if (p < 1) window.requestAnimationFrame(step);
      else el.textContent = target;
    }
    window.requestAnimationFrame(step);
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (ent) {
        if (ent.isIntersecting) {
          animateCount(ent.target);
          io.unobserve(ent.target);
        }
      });
    }, { threshold: 0.4 });
    counters.forEach(function (c) { io.observe(c); });
  }

  highlight();
})();
