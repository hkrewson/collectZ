import React from 'react';
import ActivityFeedView from './ActivityFeedView';

export default function AdminActivityView({ apiCall, Spinner }) {
  return (
    <ActivityFeedView
      apiCall={apiCall}
      Spinner={Spinner}
      endpoint="/admin/activity"
      title="Activity"
      description="Platform audit trail for admin actions, account changes, and space-management events."
    />
  );
}
