import React from 'react';

export default function ForbiddenView({
  title = 'Access Restricted',
  detail = 'You do not have permission to view this section.'
}) {
  return (
    <div className="h-full overflow-y-auto p-6 max-w-xl">
      <div className="card p-6 space-y-3">
        <h1 className="section-title">{title}</h1>
        <p className="text-sm text-dim">{detail}</p>
      </div>
    </div>
  );
}
