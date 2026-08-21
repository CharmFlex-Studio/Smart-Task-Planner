import React from 'react';

export type IconName =
  | 'activity'
  | 'board'
  | 'calendar'
  | 'chat'
  | 'check'
  | 'chevron'
  | 'comment'
  | 'history'
  | 'more'
  | 'plus'
  | 'trash'
  | 'search'
  | 'settings'
  | 'spark'
  | 'tasks'
  | 'x'
  // Formatting toolbar. Drawn rather than set as characters, because "❝" and "🔗" land
  // as a different face and a colour emoji, neither of which belongs beside the rest.
  | 'bold'
  | 'italic'
  | 'code'
  | 'link'
  | 'bullet-list'
  | 'numbered-list'
  | 'checklist'
  | 'quote';

const paths: Record<IconName, React.ReactNode> = {
  activity: <><path d="M4 12h3l2-5 4 10 2-5h5" /></>,
  bold: <><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" /></>,
  italic: <><path d="M15 5h-5M14 19H9M14 5l-4 14" /></>,
  code: <><path d="M9 7l-5 5 5 5M15 7l5 5-5 5" /></>,
  link: <><path d="M10 13a4 4 0 0 0 5.7.4l3-3A4 4 0 0 0 13 4.7l-1.7 1.7" /><path d="M14 11a4 4 0 0 0-5.7-.4l-3 3A4 4 0 0 0 11 19.3l1.7-1.7" /></>,
  'bullet-list': <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" /></>,
  'numbered-list': <><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5.5l1.3-.7V9M3.4 15.1c0-.9.7-1.4 1.4-1.4.8 0 1.4.5 1.4 1.2 0 1.3-2.8 1.7-2.8 3.4h2.9" strokeWidth="1.4" /></>,
  checklist: <><path d="M11 6h9M11 12h9M11 18h9" /><path d="M3 6.2l1.4 1.4L7 4.8M3 16.2l1.4 1.4L7 14.8" strokeWidth="1.6" /></>,
  quote: <><path d="M9 7H6a2 2 0 0 0-2 2v3h5V7zM20 7h-3a2 2 0 0 0-2 2v3h5V7z" /><path d="M4 12c0 3 1.6 4.4 3.5 5M15 12c0 3 1.6 4.4 3.5 5" /></>,
  board: <><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="10" rx="1.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  chat: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  chevron: <><path d="m7 10 5 5 5-5" /></>,
  comment: <><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  more: <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  spark: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></>,
  tasks: <><path d="M9 6h12M9 12h12M9 18h12" /><path d="m3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
