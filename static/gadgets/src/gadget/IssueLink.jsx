import React from 'react';
import { router, NavigationTarget } from '@forge/bridge';

// Forge Custom UI runs inside a sandboxed iframe, where a plain
// <a target="_blank"> is silently blocked by the sandbox/CSP. router.open()
// is the supported way to navigate out of the gadget to a Jira issue.
export default function IssueLink({ issueKey, style }) {
  return (
    <a
      href="#"
      onClick={e => { e.preventDefault(); router.open({ target: NavigationTarget.Issue, issueKey }); }}
      style={{ color: 'var(--info-text)', cursor: 'pointer', ...style }}
    >
      {issueKey}
    </a>
  );
}
