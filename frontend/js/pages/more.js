// "More" tab on phones: the sections that don't fit in the bottom bar.
import { html, setHTML } from '../core/dom.js';
import * as D from '../core/dates.js';
import { t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { hydrateImages } from '../core/images.js';
import * as store from '../core/store.js';
import { avatarHtml } from './hero.js';

export default {
  id: 'more',
  deps: ['projects', 'notes', 'user', 'challenges'],
  title: () => t('nav.more'),
  mount(el) { this.el = el; this.update(); },
  update() {
    const user = store.getUser() || {};
    const active = store.all('projects').filter((p) => p.status === 'active').length;
    const notes = store.all('notes').length;
    const chs = store.all('challenges').filter((c) => !c.stopped && c.start_date <= D.today() && D.addDays(c.start_date, c.days - 1) >= D.today()).length;
    setHTML(this.el, html`
      <header class="page-head"><h1>${t('nav.more')}</h1></header>
      <section class="card me-card">
        ${avatarHtml(user, 'avatar-lg')}
        <div><b>${user.name || ''}</b><small class="muted">${user.email || ''}</small></div>
      </section>
      <nav class="card menu">
        <a href="#/challenges">${icon('flame', 20)}<span>${t('nav.challenges')}</span><small>${chs || ''}</small>${icon('right', 18)}</a>
        <a href="#/projects">${icon('layers', 20)}<span>${t('nav.projects')}</span><small>${active || ''}</small>${icon('right', 18)}</a>
        <a href="#/notes">${icon('note', 20)}<span>${t('nav.notes')}</span><small>${notes || ''}</small>${icon('right', 18)}</a>
        <a href="#/study/tasks">${icon('checkSquare', 20)}<span>${t('study.tab.tasks')}</span><small></small>${icon('right', 18)}</a>
        <a href="#/finance/goals">${icon('target', 20)}<span>${t('fin.tab.goals')}</span><small></small>${icon('right', 18)}</a>
        <a href="#/settings">${icon('settings', 20)}<span>${t('nav.settings')}</span><small></small>${icon('right', 18)}</a>
      </nav>`);
    hydrateImages(this.el);
  },
  unmount() { this.el = null; },
};
