import React from 'react';

export default function CollectzMark({
  className = 'h-6 w-6',
  strokeWidth = 1,
  title = 'Collectz'
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : 'presentation'}
    >
      {title ? <title>{title}</title> : null}
      <g
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 5.5H16.5C17.3284 5.5 18 6.17157 18 7V14.5" opacity="0.35" />
        <path d="M6.5 8H14C14.8284 8 15.5 8.67157 15.5 9.5V17" opacity="0.6" />
        <rect x="4" y="10.5" width="9.5" height="9" rx="1.75" />
      </g>
      <rect x="5.25" y="12" width="1.1" height="1.1" rx="0.2" fill="currentColor" />
      <rect x="5.25" y="14.45" width="1.1" height="1.1" rx="0.2" fill="currentColor" />
      <rect x="5.25" y="16.9" width="1.1" height="1.1" rx="0.2" fill="currentColor" />
    </svg>
  );
}
