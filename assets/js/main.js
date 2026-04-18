/* =========================================================
   Xiaopeng Yan — site scripts
   Handles: theme toggle, language toggle, pub filter,
            BibTeX copy buttons, current-year stamp.
   ========================================================= */
(function () {
    var THEME_KEY = 'yanxp-theme';
    var LANG_KEY = 'yanxp-lang';
    var root = document.documentElement;

    /* -------- Theme -------- */
    function applyTheme(theme) {
        root.setAttribute('data-theme', theme);
    }

    function initialTheme() {
        try {
            var saved = localStorage.getItem(THEME_KEY);
            if (saved === 'dark' || saved === 'light') return saved;
        } catch (e) {}
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    function syncThemePressed(btn) {
        if (!btn) return;
        btn.setAttribute('aria-pressed', root.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
    }

    /* -------- Language -------- */
    function applyLang(lang) {
        root.setAttribute('data-lang', lang);
        root.setAttribute('lang', lang === 'zh' ? 'zh-Hans' : 'en');
    }

    function initialLang() {
        try {
            var saved = localStorage.getItem(LANG_KEY);
            if (saved === 'zh' || saved === 'en') return saved;
        } catch (e) {}
        var nav = (navigator.language || '').toLowerCase();
        return nav.indexOf('zh') === 0 ? 'zh' : 'en';
    }

    function syncLangButton(btn) {
        if (!btn) return;
        var cur = root.getAttribute('data-lang') === 'zh' ? 'zh' : 'en';
        btn.textContent = cur === 'zh' ? 'EN' : '中文';
        btn.setAttribute('aria-label', cur === 'zh' ? 'Switch to English' : '切换到中文');
    }

    applyTheme(initialTheme());
    applyLang(initialLang());

    document.addEventListener('DOMContentLoaded', function () {
        /* Theme toggle */
        var themeBtn = document.querySelector('.theme-toggle');
        if (themeBtn) {
            syncThemePressed(themeBtn);
            themeBtn.addEventListener('click', function () {
                var cur = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
                var next = cur === 'dark' ? 'light' : 'dark';
                applyTheme(next);
                syncThemePressed(themeBtn);
                try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
            });
        }

        /* Language toggle */
        var langBtn = document.querySelector('.lang-toggle');
        if (langBtn) {
            syncLangButton(langBtn);
            langBtn.addEventListener('click', function () {
                var cur = root.getAttribute('data-lang') === 'zh' ? 'zh' : 'en';
                var next = cur === 'zh' ? 'en' : 'zh';
                applyLang(next);
                syncLangButton(langBtn);
                try { localStorage.setItem(LANG_KEY, next); } catch (e) {}
            });
        }

        /* Current year */
        var y = document.getElementById('year');
        if (y) y.textContent = new Date().getFullYear();

        /* Publication filter */
        initPubFilter();

        /* BibTeX copy buttons */
        initBibtexButtons();
    });

    /* -------- Publication filter -------- */
    function initPubFilter() {
        var btns = document.querySelectorAll('[data-pub-filter]');
        if (!btns.length) return;
        var pubs = document.querySelectorAll('.pub');

        function apply(filter) {
            pubs.forEach(function (p) {
                var type = (p.getAttribute('data-type') || '').toLowerCase();
                var match = filter === 'all' || type === filter;
                p.classList.toggle('is-hidden', !match);
            });
            btns.forEach(function (b) {
                b.setAttribute('aria-pressed', b.getAttribute('data-pub-filter') === filter ? 'true' : 'false');
            });
        }

        btns.forEach(function (b) {
            b.addEventListener('click', function () {
                apply(b.getAttribute('data-pub-filter'));
            });
        });
        apply('all');
    }

    /* -------- BibTeX copy -------- */
    function initBibtexButtons() {
        var buttons = document.querySelectorAll('.bibtex-btn');
        buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-bibtex');
                var src = id && document.getElementById(id);
                if (!src) return;
                var text = src.textContent.trim();
                var done = function () {
                    var original = btn.textContent;
                    btn.classList.add('is-copied');
                    btn.textContent = 'Copied';
                    setTimeout(function () {
                        btn.classList.remove('is-copied');
                        btn.textContent = original;
                    }, 1600);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done).catch(function () {
                        fallbackCopy(text); done();
                    });
                } else {
                    fallbackCopy(text); done();
                }
            });
        });
    }

    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }
})();
