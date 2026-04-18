(function () {
    var STORAGE_KEY = 'yanxp-theme';
    var root = document.documentElement;

    function applyTheme(theme) {
        root.setAttribute('data-theme', theme);
    }

    function initialTheme() {
        try {
            var saved = localStorage.getItem(STORAGE_KEY);
            if (saved === 'dark' || saved === 'light') return saved;
        } catch (e) {}
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    }

    applyTheme(initialTheme());

    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.querySelector('.theme-toggle');
        if (!btn) return;
        btn.addEventListener('click', function () {
            var cur = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
            var next = cur === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
        });
    });
})();
