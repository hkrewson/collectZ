'use strict';

const { postWithCsrf, getCurrentUser } = require('./auth');

async function createSpace(requestContext, { name, slug }) {
  const response = await postWithCsrf(requestContext, '/api/admin/spaces', { name, slug }, 201);
  return response.json();
}

async function deleteSpace(requestContext, spaceId) {
  const response = await postWithCsrf(requestContext, `/api/admin/spaces/${spaceId}`, undefined, 200);
  return response.json();
}

async function createSpaceFixture(requestContext, suffix) {
  const currentUser = await getCurrentUser(requestContext);
  const space = await createSpace(requestContext, {
    name: `Playwright Space ${suffix}`,
    slug: `playwright-space-${suffix}`
  });
  return {
    space,
    currentUser
  };
}

module.exports = {
  createSpace,
  deleteSpace,
  createSpaceFixture
};
