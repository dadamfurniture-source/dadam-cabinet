/* ============================================================
   segan/charts.js — 앱 화면의 작은 그래프 (window.SeganCharts)

   가로 막대 · 쌓은 가로 막대 · 주마다 선 기둥 · 작은 선. 글(HTML)을 돌려주고, 그린 뒤 animate(root) 한 번으로 움직임을 붙인다.
   (2026-11-23 「프로젝트 관리 새 틀」 — 프로젝트 관리 대시보드 segan/company-dashboard.js 가 처음 쓴다)

   규칙  숫자는 늘 글로도 적는다 — 막대는 그 옆의 그림일 뿐이다 (색만으로 알리지 않는다).
         크기는 width · height 로 정해 두고, 움직임은 transform 만 (segan/motion.js grow · draw). 멈춘 모습이 곧 최종 모습이다.
         재질은 v5 — 각진 모서리 · 그림자 없음 · 가는 선. 색은 쓰는 화면이 class 로 정한다 (shell.css .ch-*).
   ============================================================ */
/* global window */
(function () {
  'use strict';

  /** 기둥 그래프의 가장 큰 기둥 높이(px) — shell.css .ch-cols 의 높이와 맞춘다 */
  var COL_H = 96;
  var SPARK_W = 200;
  var SPARK_H = 36;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  }

  /** 0 ~ 100 */
  function share(value, max) {
    if (!(max > 0)) return 0;
    return Math.round(Math.max(0, Math.min(1, num(value) / max)) * 1000) / 10;
  }

  function maxOf(values) {
    return values.reduce(function (m, v) {
      return num(v) > m ? num(v) : m;
    }, 0);
  }

  function rowOpen(r) {
    var go = r.go ? esc(r.go) : '';
    return (
      (go ? '<a href="#' + go + '" data-me-go="' + go + '"' : '<div') +
      ' class="ch-row' +
      (r.hot ? ' ch-hot' : '') +
      '" data-ch-key="' +
      esc(r.key) +
      '">'
    );
  }

  function rowClose(r) {
    return r.go ? '</a>' : '</div>';
  }

  /**
   * 쌓은 가로 막대 — rows [{ key, label, value, text, go?, segs: [{ cls, n, label }] }]
   * 막대 길이는 value ÷ 가장 큰 value. 조각마다 수를 적고, 0 인 조각은 그리지 않는다.
   */
  function stackRows(rows) {
    var max = maxOf(
      rows.map(function (r) {
        return r.value;
      })
    );
    return (
      '<div class="ch-rows">' +
      rows
        .map(function (r, i) {
          var segs = (r.segs || [])
            .filter(function (s) {
              return num(s.n) > 0;
            })
            .map(function (s) {
              return (
                '<i class="ch-seg ' +
                esc(s.cls) +
                '" style="flex:' +
                num(s.n) +
                '" title="' +
                esc(s.label + ' ' + s.n) +
                '">' +
                esc(s.n) +
                '</i>'
              );
            })
            .join('');
          return (
            rowOpen(r) +
            '<span class="ch-label">' +
            esc(r.label) +
            '</span><span class="ch-track">' +
            (segs
              ? '<span class="ch-stack" data-ch-grow="x" data-ch-delay="' +
                i * 40 +
                '" style="width:' +
                share(r.value, max) +
                '%">' +
                segs +
                '</span>'
              : '') +
            '</span><span class="ch-value">' +
            esc(r.text) +
            '</span>' +
            rowClose(r)
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** 가로 막대 — rows [{ key, label, value, text, note?, hot?, cls?, go? }] */
  function barRows(rows) {
    var max = maxOf(
      rows.map(function (r) {
        return r.value;
      })
    );
    return (
      '<div class="ch-rows">' +
      rows
        .map(function (r, i) {
          return (
            rowOpen(r) +
            '<span class="ch-label">' +
            esc(r.label) +
            '</span><span class="ch-track">' +
            (num(r.value) > 0
              ? '<span class="ch-bar' +
                (r.cls ? ' ' + esc(r.cls) : '') +
                '" data-ch-grow="x" data-ch-delay="' +
                i * 40 +
                '" style="width:' +
                share(r.value, max) +
                '%"></span>'
              : '') +
            '</span><span class="ch-value">' +
            esc(r.text) +
            (r.note ? ' <small>' + esc(r.note) + '</small>' : '') +
            '</span>' +
            rowClose(r)
          );
        })
        .join('') +
      '</div>'
    );
  }

  /**
   * 기둥 — cols [{ label, values: { key: n } }], series [{ key, cls, label }], text(n) = 기둥 위에 적는 글 (0 은 적지 않는다)
   */
  function columns(cols, series, text) {
    var max = maxOf(
      cols.reduce(function (all, c) {
        return all.concat(
          series.map(function (s) {
            return (c.values || {})[s.key];
          })
        );
      }, [])
    );
    var say = typeof text === 'function' ? text : String;
    return (
      '<div class="ch-cols" style="grid-template-columns:repeat(' +
      cols.length +
      ',minmax(0,1fr))">' +
      cols
        .map(function (c, i) {
          return (
            '<div class="ch-col"><div class="ch-colbars">' +
            series
              .map(function (s) {
                var n = num((c.values || {})[s.key]);
                return (
                  '<span class="ch-colitem" title="' +
                  esc(c.label + ' ' + s.label + ' ' + say(n)) +
                  '"><em>' +
                  (n > 0 ? esc(say(n)) : '') +
                  '</em>' +
                  (n > 0
                    ? '<i class="ch-colbar ' +
                      esc(s.cls) +
                      '" data-ch-grow="y" data-ch-delay="' +
                      i * 40 +
                      '" style="height:' +
                      Math.max(2, Math.round((n / max) * COL_H)) +
                      'px"></i>'
                    : '') +
                  '</span>'
                );
              })
              .join('') +
            '</div><small>' +
            esc(c.label) +
            '</small></div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /** 작은 선 — 값 목록(null 은 건너뛴다). 점이 둘보다 적으면 빈 글 */
  function spark(values, label) {
    var pts = [];
    var list = Array.isArray(values) ? values : [];
    var known = list.filter(function (v) {
      return typeof v === 'number' && Number.isFinite(v);
    });
    if (known.length < 2) return '';
    var lo = Math.min.apply(null, known);
    var hi = Math.max.apply(null, known);
    var span = hi - lo || 1;
    var step = list.length > 1 ? SPARK_W / (list.length - 1) : 0;
    list.forEach(function (v, i) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      var x = Math.round(i * step * 10) / 10;
      var y = Math.round((SPARK_H - 6 - ((v - lo) / span) * (SPARK_H - 12)) * 10) / 10;
      pts.push([x, y]);
    });
    var d = pts
      .map(function (p, i) {
        return (i ? 'L' : 'M') + p[0] + ' ' + p[1];
      })
      .join(' ');
    var end = pts[pts.length - 1];
    return (
      '<svg class="ch-spark" viewBox="-4 0 ' +
      (SPARK_W + 8) +
      ' ' +
      SPARK_H +
      '" preserveAspectRatio="none" role="img" aria-label="' +
      esc(label || '') +
      '"><path data-ch-draw d="' +
      d +
      '" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="' +
      end[0] +
      '" cy="' +
      end[1] +
      '" r="3" fill="currentColor"/></svg>'
    );
  }

  /** 범례 — items [{ cls, label }] (cls 가 없으면 글만) */
  function legend(items) {
    return (
      '<p class="ch-legend">' +
      items
        .map(function (it) {
          return (
            '<span>' +
            (it.cls ? '<i class="' + esc(it.cls) + '"></i>' : '') +
            esc(it.label) +
            '</span>'
          );
        })
        .join('') +
      '</p>'
    );
  }

  /** 그린 뒤 한 번 — 막대는 자라고 선은 그려진다 (segan/motion.js. 없으면 멈춘 모습 그대로) */
  function animate(root) {
    var M = window.SeganMotion;
    if (!root || !M) return;
    var grow = root.querySelectorAll('[data-ch-grow]');
    for (var i = 0; i < grow.length; i++)
      M.grow(
        grow[i],
        1,
        grow[i].getAttribute('data-ch-grow'),
        Number(grow[i].getAttribute('data-ch-delay')) || 0
      );
    var lines = root.querySelectorAll('[data-ch-draw]');
    for (var j = 0; j < lines.length; j++) M.draw(lines[j]);
  }

  window.SeganCharts = {
    COL_H: COL_H,
    share: share,
    stackRows: stackRows,
    barRows: barRows,
    columns: columns,
    spark: spark,
    legend: legend,
    animate: animate,
  };
})();
