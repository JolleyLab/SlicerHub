// Backend-agnostic registration and invite service.
// Used by: admin-registrations-page, pending-registrations-dialog, notification-bell,
//           admin-task-groups-page, registration-request-form, invite-accept-form,
//           complete-registration-form, home-page.
export {
    submitRegistrationRequest,
    previewRegistrationToken,
    completeRegistration,
    listPendingRegistrations,
    getPendingRegistrationsCount,
    approveRegistration,
    rejectRegistration,
    previewSignupInvite,
    acceptSignupInvite,
} from './directus.js';
