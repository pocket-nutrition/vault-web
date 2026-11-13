// SPDX-License-Identifier: AGPL-3.0-or-later

// DOM is built with textContent only: nothing from the vault or the API is ever parsed as HTML. Attributes
// starting with "on" become event listeners; false and null attributes are left out.

function build(node, attrs, children) {
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function h(tag, attrs = {}, ...children) {
  return build(document.createElement(tag), attrs, children);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An SVG element. Geometry goes in attributes, colours in the stylesheet: the CSP allows no inline style. */
export function svg(tag, attrs = {}, ...children) {
  return build(document.createElementNS(SVG_NS, tag), attrs, children);
}

/** A link to an https page, opened apart from this one; anything else is shown as plain text. */
export function externalLink(href, text = href) {
  return /^https:\/\//.test(href ?? '') ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : h('span', {}, text);
}
