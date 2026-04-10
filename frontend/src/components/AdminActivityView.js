import React from 'react';
import ActivityFeedView from './ActivityFeedView';

export default function AdminActivityView({ apiCall, Spinner }) {
  return (
    <ActivityFeedView
      apiCall={apiCall}
      Spinner={Spinner}
      endpoint="/admin/activity"
      title="Platform Activity"
      description="Platform-wide audit trail for admin actions, account changes, and cross-space management events. Space-local activity lives in My Space."
    />
  );
}
