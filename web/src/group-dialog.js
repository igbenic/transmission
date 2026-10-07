/* @license This file Copyright © Mnemosyne LLC.
   It may be used under GPLv2 (SPDX: GPL-2.0-only), GPLv3 (SPDX: GPL-3.0-only),
   or any future license endorsed by Mnemosyne LLC.
   License text can be found in the licenses/ folder. */

import { AlertDialog } from './alert-dialog.js';
import { createDialogContainer } from './utils.js';

export class GroupDialog extends EventTarget {
  constructor(controller, remote) {
    super();

    this.controller = controller;
    this.remote = remote;
    this.elements = {};
    this.torrents = [];

    this.show();
  }

  show() {
    const torrents = this.controller.getSelectedTorrents();
    if (torrents.length === 0) {
      return;
    }

    this.torrents = torrents;
    this.elements = GroupDialog._create();
    this.elements.dismiss.addEventListener('click', () => this._onDismiss());
    this.elements.confirm.addEventListener('click', () => this._onConfirm());
    document.body.append(this.elements.root);

    this.remote.loadClientGroups((groups) => {
      if (this.closed) {
        return;
      }
      if (groups.length === 0) {
        this.close();
        this.controller.setCurrentPopup(
          new AlertDialog({
            heading: 'No groups available',
            message:
              'This server does not provide torrent groups, or none have been created.',
          }),
        );
        return;
      }
      GroupDialog._fill_options(
        this.elements.select,
        groups,
        torrents[0].getClientGroup(),
      );
    });

    this.elements.select.focus();
  }

  close() {
    if (this.closed) {
      return;
    }
    this.elements.root.remove();
    this.dispatchEvent(new Event('close'));

    delete this.controller;
    delete this.remote;
    delete this.elements;
    delete this.torrents;
    this.closed = true;
  }

  _onDismiss() {
    this.close();
  }

  _onConfirm() {
    const { torrents, remote } = this;
    const group = Number.parseInt(this.elements.select.value, 10);
    if (Number.isNaN(group)) {
      this.close();
      return;
    }

    const ids = torrents.map((t) => t.getId());
    remote.setClientGroup(ids, group, () => {
      for (const t of torrents) {
        t.refresh({ client_group: group });
      }
    });
    this.close();
  }

  static _fill_options(select, groups, current) {
    select.replaceChildren();

    const none = document.createElement('option');
    none.value = '-1';
    none.textContent = 'No group';
    select.append(none);

    for (const group of groups) {
      const option = document.createElement('option');
      option.value = String(group.id);
      option.textContent = group.download_dir
        ? `${group.name} (${group.download_dir})`
        : group.name;
      select.append(option);
    }
    select.value = String(current);
  }

  static _create() {
    const elements = createDialogContainer('group-dialog');
    elements.root.setAttribute('aria-label', 'Set Group');
    elements.heading.textContent = 'Set Group:';
    elements.confirm.textContent = 'Apply';

    const label = document.createElement('label');
    label.setAttribute('for', 'torrent-group');
    label.textContent = 'Group:';
    elements.workarea.append(label);

    const select = document.createElement('select');
    select.id = 'torrent-group';
    elements.select = select;
    elements.workarea.append(select);

    return elements;
  }
}
