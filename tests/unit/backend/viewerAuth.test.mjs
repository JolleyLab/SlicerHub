import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

// nginx auth_request calls /api/internal/viewer-auth before proxying to a viewer
// container. isViewerPathAllowed must accept a user's own seats/sessions and reject
// everyone else's, mirroring how nginx/default.conf builds container names from the path.
mock.module('../../../backend/src/middleware/authMiddleware.js', {
    namedExports: { authenticateToken: (req, res, next) => next() }
});

const { isViewerPathAllowed } = await import('../../../backend/src/routes/viewerAuth.js');

const ME = { id: 'aaaa-1111', role: 'user' };
const ADMIN = { id: 'bbbb-2222', role: 'admin' };
const noTrame = { getTrameSession: () => null };

test('a user can open their own Full Slicer seats', () => {
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111-seat1/slicer-vnc.html', ME, noTrame), true);
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111-seat2/websockify', ME, noTrame), true);
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111/vnc.html', ME, noTrame), true);
});

test("a user cannot open someone else's Full Slicer seat", () => {
    assert.equal(isViewerPathAllowed('/slicer-gui/user-cccc-3333-seat1/vnc.html', ME, noTrame), false);
    assert.equal(isViewerPathAllowed('/slicer-gui/user-cccc-3333/vnc.html', ME, noTrame), false);
});

test('a seat path that only starts with the user id is rejected', () => {
    // Would be container slicer-gui-aaaa-1111x-seat1 — a different user.
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111x-seat1/', ME, noTrame), false);
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111-seat/', ME, noTrame), false);
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111-seat1x/', ME, noTrame), false);
});

test('site admins get no access to other users seats', () => {
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111-seat1/', ADMIN, noTrame), false);
});

test('Trame sessions are limited to their owner', () => {
    assert.equal(isViewerPathAllowed('/trame-session/user-aaaa-1111/index.html', ME, noTrame), true);
    assert.equal(isViewerPathAllowed('/trame-session/user-cccc-3333/index.html', ME, noTrame), false);
});

test('a Trame port is allowed only when it is the port of the caller\'s own session', () => {
    const lookup = { getTrameSession: (id) => (id === 'aaaa-1111' ? { metadata: { sessionPort: 9003 } } : null) };
    assert.equal(isViewerPathAllowed('/trame-session-port/9003/', ME, lookup), true);
    assert.equal(isViewerPathAllowed('/trame-session-port/9004/', ME, lookup), false);
    assert.equal(isViewerPathAllowed('/trame-session-port/8090/api/sessions', ME, lookup), false);
    assert.equal(isViewerPathAllowed('/trame-session-port/9003/', ME, noTrame), false);
});

test('the shared debug desktop and legacy Trame are admin-only', () => {
    assert.equal(isViewerPathAllowed('/slicer-gui/vnc.html', ME, noTrame), false);
    assert.equal(isViewerPathAllowed('/trame/', ME, noTrame), false);
    assert.equal(isViewerPathAllowed('/slicer-gui/vnc.html', ADMIN, noTrame), true);
    assert.equal(isViewerPathAllowed('/trame/', ADMIN, noTrame), true);
});

test('unknown paths and missing users are rejected', () => {
    assert.equal(isViewerPathAllowed('/api/cases', ME, noTrame), false);
    assert.equal(isViewerPathAllowed('', ME, noTrame), false);
    assert.equal(isViewerPathAllowed('/slicer-gui/user-aaaa-1111-seat1/', null, noTrame), false);
});
