import {exactRequestCondition} from './media-headers.js';

export const HEADER_RULE_MIN = 600000000;
export const HEADER_RULE_MAX = 1000000000;

const RESTRICTED_HEADER_RE = /^(Origin|Referer|Cookie)$/i;

export function stripRestrictedHeaders(headers = {}) {
  const clean = new Headers(headers);
  for (const key of ['Origin', 'Referer', 'Cookie']) clean.delete(key);
  return clean;
}

export function extractHeaderRules(headers = {}) {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers || {});
  return entries
    .filter(([key, value]) => RESTRICTED_HEADER_RE.test(key) && typeof value === 'string' && value && !/[\r\n]/.test(value))
    .map(([header, value]) => ({operation: 'set', header, value}));
}

export function createHeaderRules({dnr} = {}) {
  const activeIds = new Set();
  const getDnr = () => dnr ?? globalThis.chrome?.declarativeNetRequest;

  function allocateRuleId() {
    let id;
    do {
      id = HEADER_RULE_MIN + Math.floor(Math.random() * (HEADER_RULE_MAX - HEADER_RULE_MIN));
    } while (activeIds.has(id));
    return id;
  }

  async function addHeaders(url, headers = {}) {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw Error('Invalid request URL');
    const requestHeaders = extractHeaderRules(headers);
    if (!requestHeaders.length) return 0;
    const api = getDnr();
    if (!api?.updateSessionRules) return 0;
    const id = allocateRuleId();
    await api.updateSessionRules({
      addRules: [{id, priority: 1, action: {type: 'modifyHeaders', requestHeaders}, condition: exactRequestCondition(parsed.href)}]
    });
    activeIds.add(id);
    return id;
  }

  async function releaseHeaders(id) {
    if (!id || !activeIds.has(id)) return;
    const api = getDnr();
    try {
      if (api?.updateSessionRules) await api.updateSessionRules({removeRuleIds: [id]});
    } finally {
      activeIds.delete(id);
    }
  }

  function adopt(ids = []) {
    for (const id of ids) {
      if (Number.isInteger(id)) activeIds.add(id);
    }
  }

  async function sweepOrphanRules(extraKeepIds = []) {
    const api = getDnr();
    if (!api?.getSessionRules || !api?.updateSessionRules) return [];
    const keep = new Set(activeIds);
    for (const id of extraKeepIds) keep.add(id);
    const rules = (await api.getSessionRules()) || [];
    const orphaned = rules
      .filter(rule => rule.id >= HEADER_RULE_MIN && rule.id < HEADER_RULE_MAX && !keep.has(rule.id))
      .map(rule => rule.id);
    if (orphaned.length) await api.updateSessionRules({removeRuleIds: orphaned});
    return orphaned;
  }

  async function withHeaders(url, headers, fn) {
    const cleanHeaders = stripRestrictedHeaders(headers);
    const ruleId = await addHeaders(url, headers);
    try {
      return await fn(cleanHeaders, ruleId);
    } finally {
      if (ruleId) await releaseHeaders(ruleId).catch(() => {});
    }
  }

  return {activeIds, allocateRuleId, addHeaders, releaseHeaders, adopt, sweepOrphanRules, withHeaders};
}
