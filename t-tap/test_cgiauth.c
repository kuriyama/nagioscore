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
 * cgi/cgiauth.c's is_authorized_for_*() functions are the authorization
 * decisions gating every CGI's view/command access -- get one of these
 * wrong (e.g. flip a TRUE/FALSE, or change what happens when
 * use_authentication is off) and it is a silent authorization bypass or
 * lockout, not a crash, so nothing else would catch it. This test covers
 * the object-graph-independent subset (decisions that only depend on
 * `authdata` fields and the global `use_authentication` flag, not on a
 * populated host/contact/service graph): is_authorized_for_all_hosts(),
 * is_authorized_for_all_services(), is_authorized_for_read_only(),
 * is_authorized_for_system_information(),
 * is_authorized_for_configuration_information(),
 * is_authorized_for_system_commands().
 *
 * The host/service/hostgroup/servicegroup-graph-dependent checks
 * (is_authorized_for_host(), is_authorized_for_service(),
 * is_authorized_for_hostgroup(), is_authorized_for_servicegroup(), and
 * the *_commands() variants) are NOT covered here -- they need a
 * populated object graph (real host/contact fixtures wired through
 * find_host()/find_contact()/is_contact_for_host()/etc., which are
 * stubbed out to FALSE/NULL in stub_objects.c and
 * stub_cgiauth_deps.c for THIS test, specifically so this test does not
 * accidentally exercise them). That's a real coverage gap, called out
 * explicitly in notes/test-coverage-2026-09-23.md as follow-up work,
 * not silently left out.
 */

#include <string.h>
#include <stdlib.h>

#include "../include/config.h"
#include "../include/common.h"
#include "../include/objects.h"
#include "../include/cgiutils.h"
#include "../include/cgiauth.h"
#include "tap.h"

#include "stub_objects.c"
#include "stub_cgiauth_deps.c"

/* cgi/cgiutils.c normally defines these; that file pulls in a much larger
   dependency chain (CGI config-file loading, HTML helpers, ...) that this
   test has no need for, so the two globals cgiauth.c actually reads are
   defined directly here instead of linking the real cgiutils.o. */
int use_authentication = TRUE;
int use_ssl_authentication = FALSE;

static void reset_authinfo(authdata *a) {
	memset(a, 0, sizeof(*a));
	a->username = "testuser";
	}

int
main() {
	authdata a;

	plan_tests(33);

	/* --- use_authentication == FALSE: every check "fakes" full access,
	   regardless of the authdata contents (even NULL-ish/zeroed) --- */
	use_authentication = FALSE;
	reset_authinfo(&a);
	ok(is_authorized_for_all_hosts(&a) == TRUE, "auth disabled: is_authorized_for_all_hosts is TRUE");
	ok(is_authorized_for_all_services(&a) == TRUE, "auth disabled: is_authorized_for_all_services is TRUE");
	ok(is_authorized_for_system_information(&a) == TRUE, "auth disabled: is_authorized_for_system_information is TRUE");
	ok(is_authorized_for_configuration_information(&a) == TRUE, "auth disabled: is_authorized_for_configuration_information is TRUE");
	ok(is_authorized_for_system_commands(&a) == TRUE, "auth disabled: is_authorized_for_system_commands is TRUE");
	/* is_authorized_for_read_only is the one function in this family
	   with inverted semantics (it reports a *restriction*, not a
	   *permission*): "fake full access" means returning FALSE here,
	   not TRUE. This is the one most likely to get flipped by mistake
	   in a future refactor, which is exactly why it's pinned down. */
	ok(is_authorized_for_read_only(&a) == FALSE, "auth disabled: is_authorized_for_read_only is FALSE (fakes full, non-restricted access)");

	/* --- use_authentication == TRUE, authenticated == FALSE: every
	   check must deny, regardless of what the individual authorized_*
	   flags say (an unauthenticated request must never be granted
	   anything just because a stale/default-zeroed flag looks
	   permissive) --- */
	use_authentication = TRUE;
	reset_authinfo(&a);
	a.authenticated = FALSE;
	a.authorized_for_all_hosts = TRUE;
	a.authorized_for_all_services = TRUE;
	a.authorized_for_system_information = TRUE;
	a.authorized_for_configuration_information = TRUE;
	a.authorized_for_system_commands = TRUE;
	a.authorized_for_read_only = FALSE;
	ok(is_authorized_for_all_hosts(&a) == FALSE, "unauthenticated: is_authorized_for_all_hosts denies despite flag set");
	ok(is_authorized_for_all_services(&a) == FALSE, "unauthenticated: is_authorized_for_all_services denies despite flag set");
	ok(is_authorized_for_system_information(&a) == FALSE, "unauthenticated: is_authorized_for_system_information denies despite flag set");
	ok(is_authorized_for_configuration_information(&a) == FALSE, "unauthenticated: is_authorized_for_configuration_information denies despite flag set");
	ok(is_authorized_for_system_commands(&a) == FALSE, "unauthenticated: is_authorized_for_system_commands denies despite flag set");
	ok(is_authorized_for_read_only(&a) == FALSE, "unauthenticated: is_authorized_for_read_only denies (returns FALSE) regardless of the flag");

	/* --- use_authentication == TRUE, authenticated == TRUE: the
	   decision must follow the per-user flag exactly, in both
	   directions (TRUE stays TRUE, FALSE stays FALSE) --- */
	use_authentication = TRUE;
	reset_authinfo(&a);
	a.authenticated = TRUE;

	a.authorized_for_all_hosts = TRUE;
	ok(is_authorized_for_all_hosts(&a) == TRUE, "authenticated + flag TRUE: is_authorized_for_all_hosts is TRUE");
	a.authorized_for_all_hosts = FALSE;
	ok(is_authorized_for_all_hosts(&a) == FALSE, "authenticated + flag FALSE: is_authorized_for_all_hosts is FALSE");

	a.authorized_for_all_services = TRUE;
	ok(is_authorized_for_all_services(&a) == TRUE, "authenticated + flag TRUE: is_authorized_for_all_services is TRUE");
	a.authorized_for_all_services = FALSE;
	ok(is_authorized_for_all_services(&a) == FALSE, "authenticated + flag FALSE: is_authorized_for_all_services is FALSE");

	a.authorized_for_system_information = TRUE;
	ok(is_authorized_for_system_information(&a) == TRUE, "authenticated + flag TRUE: is_authorized_for_system_information is TRUE");
	a.authorized_for_system_information = FALSE;
	ok(is_authorized_for_system_information(&a) == FALSE, "authenticated + flag FALSE: is_authorized_for_system_information is FALSE");

	a.authorized_for_configuration_information = TRUE;
	ok(is_authorized_for_configuration_information(&a) == TRUE, "authenticated + flag TRUE: is_authorized_for_configuration_information is TRUE");
	a.authorized_for_configuration_information = FALSE;
	ok(is_authorized_for_configuration_information(&a) == FALSE, "authenticated + flag FALSE: is_authorized_for_configuration_information is FALSE");

	a.authorized_for_system_commands = TRUE;
	ok(is_authorized_for_system_commands(&a) == TRUE, "authenticated + flag TRUE: is_authorized_for_system_commands is TRUE");
	a.authorized_for_system_commands = FALSE;
	ok(is_authorized_for_system_commands(&a) == FALSE, "authenticated + flag FALSE: is_authorized_for_system_commands is FALSE");

	a.authorized_for_read_only = TRUE;
	ok(is_authorized_for_read_only(&a) == TRUE, "authenticated + flag TRUE: is_authorized_for_read_only is TRUE");
	a.authorized_for_read_only = FALSE;
	ok(is_authorized_for_read_only(&a) == FALSE, "authenticated + flag FALSE: is_authorized_for_read_only is FALSE");

	/* --- one flag being TRUE must not leak into an unrelated check:
	   guards against a copy-paste bug where e.g.
	   is_authorized_for_system_commands accidentally reads
	   authorized_for_all_hosts instead of its own field --- */
	use_authentication = TRUE;
	reset_authinfo(&a);
	a.authenticated = TRUE;
	a.authorized_for_all_hosts = TRUE;
	/* every OTHER flag stays FALSE from reset_authinfo's memset */
	ok(is_authorized_for_all_services(&a) == FALSE, "authorized_for_all_hosts=TRUE does not leak into is_authorized_for_all_services");
	ok(is_authorized_for_system_information(&a) == FALSE, "authorized_for_all_hosts=TRUE does not leak into is_authorized_for_system_information");
	ok(is_authorized_for_configuration_information(&a) == FALSE, "authorized_for_all_hosts=TRUE does not leak into is_authorized_for_configuration_information");
	ok(is_authorized_for_system_commands(&a) == FALSE, "authorized_for_all_hosts=TRUE does not leak into is_authorized_for_system_commands");
	ok(is_authorized_for_read_only(&a) == FALSE, "authorized_for_all_hosts=TRUE does not leak into is_authorized_for_read_only");

	/* --- NULL host/service short-circuit to FALSE in the graph-aware
	   functions, independent of authentication state -- cheap to check
	   even without a populated object graph, and a real defense against
	   a null host/service pointer being silently treated as
	   "authorized" --- */
	use_authentication = FALSE;
	reset_authinfo(&a);
	ok(is_authorized_for_host(NULL, &a) == FALSE, "is_authorized_for_host(NULL, ...) is FALSE even with auth disabled");
	ok(is_authorized_for_service(NULL, &a) == FALSE, "is_authorized_for_service(NULL, ...) is FALSE even with auth disabled");
	ok(is_authorized_for_hostgroup(NULL, &a) == FALSE, "is_authorized_for_hostgroup(NULL, ...) is FALSE");
	ok(is_authorized_for_servicegroup(NULL, &a) == FALSE, "is_authorized_for_servicegroup(NULL, ...) is FALSE");

	return exit_status();
	}
