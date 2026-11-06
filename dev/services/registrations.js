// Backend-agnostic registration and invite service.
// Used by: admin-registrations-page, pending-registrations-dialog, notification-bell,
//           admin-task-groups-page, home-page.
export {
    listPendingRegistrations,
    getPendingRegistrationsCount,
    approveRegistration,
    rejectRegistration,
} from './directus.js';
