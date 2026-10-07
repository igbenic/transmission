/* @license This file Copyright © Mnemosyne LLC.
   It may be used under GPLv2 (SPDX: GPL-2.0-only), GPLv3 (SPDX: GPL-3.0-only),
   or any future license endorsed by Mnemosyne LLC.
   License text can be found in the licenses/ folder. */

import { AlertDialog } from './alert-dialog.js';
import { Formatter } from './formatter.js';
import { RPC } from './remote.js';
import { createDialogContainer, makeUUID } from './utils.js';

const is_ios =
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !globalThis.MSStream;
const is_safari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
// https://github.com/transmission/transmission/pull/6320#issuecomment-1896968904
// https://caniuse.com/input-file-accept
const can_use_input_accept = !(is_ios && is_safari);

export class OpenDialog extends EventTarget {
  constructor(controller, remote, url = '', files = null) {
    super();

    this.controller = controller;
    this.remote = remote;

    this.elements = this._create(url);
    this.elements.dismiss.addEventListener('click', () => this._onDismiss());
    this.elements.confirm.addEventListener('click', () => this._onConfirm());
    document.body.append(this.elements.root);
    if (files) {
      this.elements.file_input.files = files;
    }
    this._updateFreeSpaceInAddDialog();
    this.elements.url_input.focus();
  }

  close() {
    if (!this.closed) {
      clearInterval(this.interval);

      this.elements.root.remove();
      this.dispatchEvent(new Event('close'));

      for (const key of Object.keys(this)) {
        delete this[key];
      }
      this.closed = true;
    }
  }

  _onDismiss() {
    this.close();
  }

  _updateFreeSpaceInAddDialog() {
    const path = this.elements.folder_input.value;
    this.remote.getFreeSpace(path, (dir, bytes) => {
      if (!this.closed) {
        this.elements.freespace.textContent =
          bytes > 0 ? `${Formatter.size(bytes)} Free` : '';
      }
    });
  }

  _onConfirm() {
    const { controller, elements, remote } = this;
    const { file_input, folder_input, start_input, url_input } = elements;
    const paused = !start_input.checked;
    const destination = folder_input.value.trim();
    const group = Number.parseInt(elements.group_input.value, 10);

    for (const file of file_input.files) {
      const reader = new FileReader();
      reader.addEventListener('load', (e) => {
        const contents = e.target.result;
        const key = 'base64,';
        const index = contents.indexOf(key);
        if (index === -1) {
          return;
        }
        const o = {
          id: 'webui',
          jsonrpc: RPC._JsonRpcVersion,
          method: 'torrent_add',
          params: {
            download_dir: destination,
            metainfo: contents.slice(Math.max(0, index + key.length)),
            paused,
          },
        };
        remote.sendRequest(o, (response) => {
          OpenDialog._assignGroup(remote, response, group);
          if ('error' in response) {
            const message =
              response.error.data?.errorString ?? response.error.message;
            alert(`Error adding "${file.name}": ${message}`);
            controller.setCurrentPopup(
              new AlertDialog({
                heading: `Error adding "${file.name}"`,
                message,
              }),
            );
          }
        });
      });
      reader.readAsDataURL(file);
    }

    let url = url_input.value.trim();
    if (url.length > 0) {
      if (/^[\da-f]{40}$/i.test(url)) {
        url = `magnet:?xt=urn:btih:${url}`;
      }
      const o = {
        id: 'webui',
        jsonrpc: RPC._JsonRpcVersion,
        method: 'torrent_add',
        params: {
          download_dir: destination,
          filename: url,
          paused,
        },
      };
      remote.sendRequest(o, (payload) => {
        OpenDialog._assignGroup(remote, payload, group);
        if ('error' in payload) {
          controller.setCurrentPopup(
            new AlertDialog({
              heading: `Error adding "${url}"`,
              message: payload.error.data?.errorString ?? payload.error.message,
            }),
          );
        }
      });
    }

    this._onDismiss();
  }

  static _assignGroup(remote, response, group) {
    const added =
      response?.result?.torrent_added ?? response?.result?.torrent_duplicate;
    if (group >= 0 && added) {
      remote.setClientGroup([added.id], group, () =>
        remote._controller.refreshTorrents(),
      );
    }
  }

  _onGroupChanged() {
    const { group_input, folder_input } = this.elements;
    const dir = group_input.selectedOptions[0]?.dataset.downloadDir;
    if (dir) {
      folder_input.value = dir;
      this._updateFreeSpaceInAddDialog();
    }
  }

  _create(url) {
    const elements = createDialogContainer();
    const { confirm, root, heading, workarea } = elements;

    root.classList.add('open-torrent');
    heading.textContent = 'Add Torrents';
    confirm.textContent = 'Add';

    let input_id = makeUUID();
    let label = document.createElement('label');
    label.setAttribute('for', input_id);
    label.textContent = 'Please select torrent files to add:';
    workarea.append(label);

    let input = document.createElement('input');
    input.type = 'file';
    input.name = 'torrent-files[]';
    input.id = input_id;
    input.multiple = true;
    if (can_use_input_accept) {
      input.accept = '.torrent,application/x-bittorrent';
    }
    workarea.append(input);
    elements.file_input = input;

    input_id = makeUUID();
    label = document.createElement('label');
    label.setAttribute('for', input_id);
    label.textContent = 'Or enter a URL:';
    workarea.append(label);

    input = document.createElement('input');
    input.type = 'url';
    input.id = input_id;
    input.value = url;
    workarea.append(input);
    elements.url_input = input;

    input_id = makeUUID();
    label = document.createElement('label');
    label.id = 'add-dialog-folder-label';
    label.for = input_id;
    label.textContent = 'Destination folder: ';
    workarea.append(label);

    const freespace = document.createElement('span');
    freespace.id = 'free-space-text';
    label.append(freespace);
    workarea.append(label);
    elements.freespace = freespace;

    input = document.createElement('input');
    input.type = 'text';
    input.id = 'add-dialog-folder-input';
    input.addEventListener('change', () => this._updateFreeSpaceInAddDialog());
    input.value = this.controller.session_properties.download_dir;
    workarea.append(input);
    elements.folder_input = input;

    const group_label = document.createElement('label');
    group_label.id = 'add-dialog-group-label';
    group_label.textContent = 'Group: ';
    group_label.hidden = true;
    const group_select = document.createElement('select');
    group_select.id = 'add-dialog-group-input';
    const no_group = document.createElement('option');
    no_group.value = '-1';
    no_group.textContent = 'No group';
    group_select.append(no_group);
    group_select.addEventListener('change', () => this._onGroupChanged());
    group_label.append(group_select);
    workarea.append(group_label);
    elements.group_input = group_select;
    this.remote.loadClientGroups((groups) => {
      if (this.closed || groups.length === 0) {
        return;
      }
      for (const g of groups) {
        const option = document.createElement('option');
        option.value = String(g.id);
        option.textContent = g.name;
        option.dataset.downloadDir = g.download_dir;
        group_select.append(option);
      }
      group_label.hidden = false;
    });

    const checkarea = document.createElement('div');
    workarea.append(checkarea);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.id = 'auto-start-check';
    check.checked = this.controller.shouldAddedTorrentsStart();
    checkarea.append(check);
    elements.start_input = check;

    label = document.createElement('label');
    label.id = 'auto-start-label';
    label.setAttribute('for', check.id);
    label.textContent = 'Start when added';
    checkarea.append(label);

    return elements;
  }
}
