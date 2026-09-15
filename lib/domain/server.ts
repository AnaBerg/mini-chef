import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createInvitationService } from "./invitations";
import { createHouseholdService } from "./households";
import { createDomainExecutor } from "./commands";

/** Use from server actions/routes. No user or membership ID is accepted from the client as identity. */
export function getDomainExecutor() {
  return createDomainExecutor(getDb(), async () => {
    const current = await getAuth().api.getSession({ headers: await headers() });
    return current ? { id: current.session.id, userId: current.user.id } : null;
  });
}

export function getHouseholdService() {
  return createHouseholdService(getDb(), async () => {
    const current = await getAuth().api.getSession({ headers: await headers() });
    return current ? { id: current.session.id, userId: current.user.id } : null;
  });
}

export function getInvitationService() {
  return createInvitationService(getDb(), async () => {
    const current = await getAuth().api.getSession({ headers: await headers() });
    return current ? { id: current.session.id, userId: current.user.id } : null;
  });
}
