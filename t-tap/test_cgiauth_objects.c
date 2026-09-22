/*****************************************************************************
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*
*
*****************************************************************************/

/*
 * cgi/cgiauth.c's object-graph-dependent authorization functions
 * (is_authorized_for_host/service/hostgroup/servicegroup and their
 * *_commands() siblings) gate every CGI's per-host/per-service view and
 * command access. test_cgiauth.c (added earlier this session) covers the
 * authdata-only subset of cgiauth.c that doesn't need a populated object
 * graph; this file covers the other half, using a REAL object graph built
 * with common/objects.c's actual object-creation API (add_host/
 * add_contact/add_contact_to_host/add_hostescalation/etc. -- the same
 * functions the config parser itself calls) rather than a fixture-free
 * stub layer, so is_contact_for_host()/is_escalated_contact_for_host()/
 * find_host()/find_contact() etc. all run as their real, shipped
 * implementations against real (if minimal) host/service/contact/
 * hostgroup/servicegroup/hostescalation objects.
 *
 * Deliberately NOT covered here (documented, not silently skipped -- see
 * notes/cgiauth-object-tests-2026-09-23.md):
 *   - serviceescalation-based authorization (is_escalated_contact_for_service
 *     via a real serviceescalation object) -- the hostescalation path is
 *     covered and exercises the same is_contact_for_*_escalation() logic;
 *     a serviceescalation fixture would be close to duplicate coverage.
 *   - hostdependency/servicedependency (unrelated to authorization).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../include/config.h"
#include "../include/common.h"
#include "../include/objects.h"
#include "../include/cgiauth.h"
#include "../include/logging.h"
#include "tap.h"

int use_authentication = TRUE;
int use_ssl_authentication = FALSE;
int debug_level = 0;
int debug_verbosity = 0;

#include "stub_logging.c"

/* ---- minimal fixture-building helpers ----
   Each wraps the real add_*() API with sensible defaults for the many
   parameters these tests don't care about, keeping the scenarios below
   readable. */

static host *mk_host(char *name) {
	return add_host(name, NULL, NULL, NULL, NULL, 0, 0, 0, 1, 0, 0, 0, NULL,
		TRUE, "check_dummy", TRUE, TRUE, NULL, TRUE, FALSE, 0, 0, 0, 0, FALSE,
		FALSE, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, FALSE, 0, 0,
		0, FALSE, TRUE, FALSE, FALSE, FALSE, 0);
	}

static service *mk_service(char *host_name, char *desc) {
	/* retry_interval (10th arg) must be > 0 -- add_service() rejects <= 0,
	   unlike add_host()'s retry_interval which only rejects < 0. */
	return add_service(host_name, desc, NULL, NULL, 0, 1, 0, TRUE, 0, 1, 0, 0,
		NULL, 0, TRUE, FALSE, NULL, TRUE, "check_dummy", TRUE, FALSE, 0, 0, 0,
		0, FALSE, FALSE, 0, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, FALSE,
		0);
	}

static contact *mk_contact(char *name, int can_submit_commands) {
	return add_contact(name, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, TRUE,
		TRUE, can_submit_commands, FALSE, FALSE, 0);
	}

static void reset_authinfo(authdata *a, char *username) {
	memset(a, 0, sizeof(*a));
	a->username = username;
	a->authenticated = TRUE;
	}

int
main() {
	unsigned int ocount[12];
	int i;
	authdata a;

	host *host_direct, *host_group_member, *host_escalated, *host_no_commands, *host_unrelated;
	service *svc1, *svc2, *svc_no_commands;
	hostgroup *hg_mixed, *hg_direct_only;
	servicegroup *sg_mixed, *sg_direct_only;
	contactgroup *grp_admins;
	hostescalation *he;

	plan_tests(27);

	/* --- build a small, real object graph --- */

	for (i = 0; i < 12; i++) {
		ocount[i] = 16;
		}
	create_object_tables(ocount);

	mk_contact("alice", TRUE);
	mk_contact("bob", TRUE);
	mk_contact("carol", TRUE);
	mk_contact("dave", TRUE);
	mk_contact("erin", FALSE);

	grp_admins = add_contactgroup("grp_admins", "Admins");
	add_contact_to_contactgroup(grp_admins, "bob");

	host_direct = mk_host("host_direct");
	add_contact_to_host(host_direct, "alice");

	host_group_member = mk_host("host_group_member");
	add_contactgroup_to_host(host_group_member, "grp_admins");

	host_escalated = mk_host("host_escalated");
	he = add_hostescalation("host_escalated", 1, 2, 0, NULL, 0);
	add_contact_to_hostescalation(he, "dave");

	host_no_commands = mk_host("host_no_commands");
	add_contact_to_host(host_no_commands, "erin");

	host_unrelated = mk_host("host_unrelated");

	svc1 = mk_service("host_direct", "svc1"); /* no direct contacts -- reachable only via host_direct's own authorization */
	svc2 = mk_service("host_unrelated", "svc2");
	add_contact_to_service(svc2, "carol");
	svc_no_commands = mk_service("host_no_commands", "svc_no_commands");
	add_contact_to_service(svc_no_commands, "erin");

	hg_mixed = add_hostgroup("hg_mixed", "Mixed", NULL, NULL, NULL);
	add_host_to_hostgroup(hg_mixed, "host_direct");
	add_host_to_hostgroup(hg_mixed, "host_unrelated");

	hg_direct_only = add_hostgroup("hg_direct_only", "Direct only", NULL, NULL, NULL);
	add_host_to_hostgroup(hg_direct_only, "host_direct");

	sg_mixed = add_servicegroup("sg_mixed", "Mixed", NULL, NULL, NULL);
	add_service_to_servicegroup(sg_mixed, "host_direct", "svc1");
	add_service_to_servicegroup(sg_mixed, "host_unrelated", "svc2");

	sg_direct_only = add_servicegroup("sg_direct_only", "Direct only", NULL, NULL, NULL);
	add_service_to_servicegroup(sg_direct_only, "host_direct", "svc1");

	/* --- is_authorized_for_host(): direct contact / contactgroup / escalation / unrelated --- */

	reset_authinfo(&a, "alice");
	ok(is_authorized_for_host(host_direct, &a) == TRUE, "direct host contact is authorized for that host");

	reset_authinfo(&a, "carol");
	ok(is_authorized_for_host(host_direct, &a) == FALSE, "an unrelated contact is denied for a host they have no relation to");

	reset_authinfo(&a, "bob");
	ok(is_authorized_for_host(host_group_member, &a) == TRUE, "a contact reaching a host via contactgroup membership is authorized");

	reset_authinfo(&a, "dave");
	ok(is_authorized_for_host(host_escalated, &a) == TRUE, "an escalation-only contact is authorized via is_escalated_contact_for_host");

	use_authentication = FALSE;
	reset_authinfo(&a, "carol");
	ok(is_authorized_for_host(host_unrelated, &a) == TRUE, "use_authentication == FALSE authorizes even an unrelated contact");
	use_authentication = TRUE;

	/* --- is_authorized_for_service(): direct contact, and the "authorized for the host implies authorized for its services" shortcut --- */

	reset_authinfo(&a, "alice");
	ok(is_authorized_for_service(svc1, &a) == TRUE, "authorization for a host's contact extends to that host's services with no contacts of their own");

	reset_authinfo(&a, "carol");
	ok(is_authorized_for_service(svc2, &a) == TRUE, "a direct service contact is authorized for that service");

	reset_authinfo(&a, "bob");
	ok(is_authorized_for_service(svc2, &a) == FALSE, "a contact with no relation to a service or its host is denied");

	/* --- hostgroup/servicegroup VIEW authorization: ANY member authorizes the whole group --- */

	reset_authinfo(&a, "alice");
	ok(is_authorized_for_hostgroup(hg_mixed, &a) == TRUE,
		"hostgroup view access is granted if the contact is authorized for ANY single member host (even though another member denies them)");

	reset_authinfo(&a, "carol");
	ok(is_authorized_for_hostgroup(hg_mixed, &a) == FALSE, "hostgroup view access is denied if no member host authorizes the contact");

	reset_authinfo(&a, "alice");
	ok(is_authorized_for_servicegroup(sg_mixed, &a) == TRUE,
		"servicegroup view access is granted if the contact is authorized for ANY single member service");

	reset_authinfo(&a, "bob");
	ok(is_authorized_for_servicegroup(sg_mixed, &a) == FALSE, "servicegroup view access is denied if no member service authorizes the contact");

	/* --- is_authorized_for_host_commands()/is_authorized_for_service_commands(): the can_submit_commands gate and the *_all_*_commands override --- */

	reset_authinfo(&a, "alice");
	ok(is_authorized_for_host_commands(host_direct, &a) == TRUE, "a contact with can_submit_commands can issue commands for their own host");

	reset_authinfo(&a, "erin");
	ok(is_authorized_for_host_commands(host_no_commands, &a) == FALSE,
		"can_submit_commands == FALSE blocks command authorization even for a contact who otherwise has view access");

	reset_authinfo(&a, "erin");
	ok(is_authorized_for_service_commands(svc_no_commands, &a) == FALSE,
		"can_submit_commands == FALSE blocks service command authorization the same way");

	reset_authinfo(&a, "carol");
	ok(is_authorized_for_host_commands(host_unrelated, &a) == FALSE,
		"an unrelated contact with no *_all_host_commands flag is denied host commands");
	a.authorized_for_all_host_commands = TRUE;
	ok(is_authorized_for_host_commands(host_unrelated, &a) == FALSE,
		"authorized_for_all_host_commands alone, WITHOUT authorized_for_all_hosts, is still not enough: "
		"is_authorized_for_host_commands() only reaches the *_all_host_commands check at all once "
		"is_authorized_for_host() has already granted VIEW access by some other means -- a subtlety "
		"worth pinning down, since it means the two flags must be paired in cgi.cfg to have any effect");
	a.authorized_for_all_hosts = TRUE;
	ok(is_authorized_for_host_commands(host_unrelated, &a) == TRUE,
		"...and DOES grant command access once paired with authorized_for_all_hosts (which supplies the "
		"view authorization the commands check is gated behind)");

	reset_authinfo(&a, "carol");
	ok(is_authorized_for_service_commands(svc2, &a) == TRUE, "carol (a direct contact of svc2) can issue commands for it");
	{
		contact *carol = find_contact("carol");
		carol->can_submit_commands = FALSE;
		ok(is_authorized_for_service_commands(svc2, &a) == FALSE,
			"...but not once can_submit_commands is revoked, even though she is still a direct contact");
		carol->can_submit_commands = TRUE;
	}

	/* same *_all_service_commands subtlety as *_all_host_commands above:
	   gated behind is_authorized_for_service() first, so it's a no-op
	   unless paired with authorized_for_all_services */
	reset_authinfo(&a, "bob");
	ok(is_authorized_for_service_commands(svc2, &a) == FALSE, "an unrelated contact is denied service commands");
	a.authorized_for_all_service_commands = TRUE;
	ok(is_authorized_for_service_commands(svc2, &a) == FALSE,
		"authorized_for_all_service_commands alone is still not enough, for the same reason as the host case above");
	a.authorized_for_all_services = TRUE;
	ok(is_authorized_for_service_commands(svc2, &a) == TRUE,
		"...and works once paired with authorized_for_all_services");

	/* --- hostgroup_commands()/servicegroup_commands(): ALL members must authorize, unlike the ANY semantics of plain view access --- */

	reset_authinfo(&a, "alice");
	ok(is_authorized_for_hostgroup_commands(hg_direct_only, &a) == TRUE,
		"hostgroup command authorization succeeds when the contact is authorized for every member host");
	ok(is_authorized_for_hostgroup_commands(hg_mixed, &a) == FALSE,
		"the SAME contact is denied hostgroup command authorization once the group has an additional member they aren't authorized to command "
		"-- confirming the ALL-members semantics differs from plain hostgroup view access (which only needs ANY member, tested above)");

	reset_authinfo(&a, "alice");
	ok(is_authorized_for_servicegroup_commands(sg_direct_only, &a) == TRUE,
		"servicegroup command authorization succeeds when the contact is authorized for every member service");
	ok(is_authorized_for_servicegroup_commands(sg_mixed, &a) == FALSE,
		"...but is denied once the group includes a service they cannot command, unlike servicegroup view access's ANY semantics");

	return exit_status();
	}
