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
 * cgi/authviewers.c labels the view decisions of cgiauth.c with the rules
 * that produced them (objectjson.cgi's authorizedviewers/authorizedobjects
 * queries). The labels are only useful if they never disagree with the
 * real decision, so besides checking the expected reasons of each rule,
 * this sweeps every candidate user over every host and service and checks
 * that explain_*() returns exactly what is_authorized_for_*() returns and
 * always has a known reason for a TRUE.
 *
 * It also covers cgiauth.c's cgi.cfg handling that the other cgiauth tests
 * skip (they use /dev/null): get_authentication_information() for
 * REMOTE_USER and default_user_name, and
 * get_authentication_information_for_user().
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "../include/config.h"
#include "../include/common.h"
#include "../include/objects.h"
#include "../include/cgiauth.h"
#include "../include/authviewers.h"
#include "../include/logging.h"
#include "tap.h"

int use_authentication = TRUE;
int use_ssl_authentication = FALSE;
int debug_level = 0;
int debug_verbosity = 0;

#include "stub_logging.c"
#include "stub_xodtemplate.c"

static char cgi_cfg_path[] = "/tmp/test_cgiauth_viewers.XXXXXX";

const char *get_cgi_config_location(void) { return cgi_cfg_path; }

static void write_cgi_cfg(const char *content) {
	FILE *fp = fopen(cgi_cfg_path, "w");
	fputs(content, fp);
	fclose(fp);
	free_auth_config_lines();
	}

static host *mk_host(char *name) {
	return add_host(name, NULL, NULL, NULL, NULL, 0, 0, 0, 1, 0, 0, 0, NULL,
		TRUE, "check_dummy", TRUE, TRUE, NULL, TRUE, FALSE, 0, 0, 0, 0, FALSE,
		FALSE, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, FALSE, 0, 0,
		0, FALSE, TRUE, FALSE, FALSE, FALSE, 0);
	}

static service *mk_service(char *host_name, char *desc) {
	return add_service(host_name, desc, NULL, NULL, 0, 1, 0, TRUE, 0, 1, 0, 0,
		NULL, 0, TRUE, FALSE, NULL, TRUE, "check_dummy", TRUE, FALSE, 0, 0, 0,
		0, FALSE, FALSE, 0, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE, FALSE,
		0);
	}

static contact *mk_contact(char *name) {
	return add_contact(name, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, TRUE,
		TRUE, TRUE, FALSE, FALSE, 0);
	}

/* the reasons joined with ' ' ("" for none), in a static buffer */
static const char *joined(auth_reasons *r) {
	static char buf[1024];
	int x;

	buf[0] = '\x0';
	for(x = 0; x < r->count; x++) {
		if(x)
			strcat(buf, " ");
		strcat(buf, r->items[x]);
		}
	return buf;
	}

/* explain_*() for user on a host or (if svc) service: "TRUE <reasons>" or
   "FALSE" */
static const char *explain(const char *user, host *hst, service *svc) {
	static char buf[1100];
	authdata a;
	auth_reasons r;
	int result;

	get_authentication_information_for_user(&a, user);
	auth_reasons_init(&r);
	result = svc ? explain_service_authorization(svc, &a, &r)
		: explain_host_authorization(hst, &a, &r);
	snprintf(buf, sizeof(buf), "%s%s%s", result ? "TRUE" : "FALSE",
		r.count ? " " : "", joined(&r));
	auth_reasons_free(&r);
	free(a.username);
	return buf;
	}

static int expect(const char *got, const char *want, const char *what) {
	int result = ok(!strcmp(got, want), "%s: %s", what, want);
	if(!result)
		diag("got: %s", got);
	return result;
	}

/* every candidate x every host and service: same decision as cgiauth.c,
   and a known reason for every TRUE */
static void sweep(const char *what) {
	char **names;
	int name_count, x, mismatches = 0, unexplained = 0, checked = 0;
	host *hst;
	service *svc;
	authdata a;
	auth_reasons r;

	names = get_auth_candidate_users(&name_count);
	for(x = 0; x < name_count; x++) {
		get_authentication_information_for_user(&a, names[x]);
		for(hst = host_list; hst; hst = hst->next) {
			auth_reasons_init(&r);
			if(explain_host_authorization(hst, &a, &r) != is_authorized_for_host(hst, &a))
				mismatches++;
			if(is_authorized_for_host(hst, &a) && (r.count == 0 || strstr(joined(&r), "unknown")))
				unexplained++;
			if(!is_authorized_for_host(hst, &a) && r.count != 0)
				unexplained++;
			auth_reasons_free(&r);
			checked++;
			}
		for(svc = service_list; svc; svc = svc->next) {
			auth_reasons_init(&r);
			if(explain_service_authorization(svc, &a, &r) != is_authorized_for_service(svc, &a))
				mismatches++;
			if(is_authorized_for_service(svc, &a) && (r.count == 0 || strstr(joined(&r), "unknown")))
				unexplained++;
			if(!is_authorized_for_service(svc, &a) && r.count != 0)
				unexplained++;
			auth_reasons_free(&r);
			checked++;
			}
		free(a.username);
		}
	free_auth_candidate_users(names, name_count);

	ok(checked > 0 && mismatches == 0, "%s: explain_*() agrees with is_authorized_for_*() for all %d user/object pairs", what, checked);
	ok(unexplained == 0, "%s: every authorization has known reasons and every denial has none (%d bad)", what, unexplained);
	}

int
main() {
	unsigned int ocount[12];
	int i, fd;
	authdata a;
	auth_reasons r;
	char **names;
	int name_count;
	char namebuf[256];
	host *host_direct, *host_group_member, *host_escalated, *host_unrelated;
	service *svc1, *svc2, *svc_cg, *svc_esc;
	contactgroup *grp_admins, *grp_ops, *grp_svc;
	hostescalation *he;
	serviceescalation *se;

	plan_tests(37);

	fd = mkstemp(cgi_cfg_path);
	close(fd);

	for(i = 0; i < 12; i++)
		ocount[i] = 16;
	create_object_tables(ocount);

	mk_contact("alice");
	mk_contact("bob");
	mk_contact("carol");
	mk_contact("dave");
	mk_contact("opsuser");
	mk_contact("frank");
	mk_contact("gina");

	grp_admins = add_contactgroup("grp_admins", "Admins");
	add_contact_to_contactgroup(grp_admins, "bob");
	grp_ops = add_contactgroup("grp_ops", "Ops");
	add_contact_to_contactgroup(grp_ops, "opsuser");
	grp_svc = add_contactgroup("grp_svc", "Service people");
	add_contact_to_contactgroup(grp_svc, "frank");

	host_direct = mk_host("host_direct");
	add_contact_to_host(host_direct, "alice");
	host_group_member = mk_host("host_group_member");
	add_contactgroup_to_host(host_group_member, "grp_admins");
	host_escalated = mk_host("host_escalated");
	he = add_hostescalation("host_escalated", 1, 2, 0, NULL, 0);
	add_contact_to_hostescalation(he, "dave");
	host_unrelated = mk_host("host_unrelated");

	svc1 = mk_service("host_direct", "svc1");
	svc2 = mk_service("host_unrelated", "svc2");
	add_contact_to_service(svc2, "carol");
	svc_cg = mk_service("host_unrelated", "svc_cg");
	add_contactgroup_to_service(svc_cg, "grp_svc");
	svc_esc = mk_service("host_unrelated", "svc_esc");
	se = add_serviceescalation("host_unrelated", "svc_esc", 1, 2, 0, NULL, 0);
	add_contact_to_serviceescalation(se, "gina");

	/* the CGIs get these from post_process_object_config() */
	contact_list = contact_ary[0];
	host_list = host_ary[0];
	service_list = service_ary[0];

	write_cgi_cfg(
		"# comment\n"
		"use_authentication=1\n"
		"default_user_name=guest\n"
		"authorized_for_all_hosts=root,carol\n"
		"authorized_for_all_services=svcadmin\n"
		"authorized_contactgroup_for_all_hosts=grp_ops,no_such_group\n"
		"authorized_for_configuration_information=root\n"
		"authorized_for_read_only=viewer\n");

	/* --- candidate users --- */
	names = get_auth_candidate_users(&name_count);
	namebuf[0] = '\x0';
	for(i = 0; i < name_count; i++) {
		if(i)
			strcat(namebuf, ",");
		strcat(namebuf, names[i]);
		}
	free_auth_candidate_users(names, name_count);
	expect(namebuf, "alice,bob,carol,dave,frank,gina,guest,opsuser,root,svcadmin,viewer",
		"candidates are all contacts plus cgi.cfg names, sorted and unique");

	/* --- get_authentication_information() still reads cgi.cfg as before --- */
	setenv("REMOTE_USER", "opsuser", 1);
	get_authentication_information(&a);
	ok(a.authenticated == TRUE && !strcmp(a.username, "opsuser"), "REMOTE_USER becomes the user name");
	ok(a.authorized_for_all_hosts == TRUE, "authorized_contactgroup_for_all_hosts applies to REMOTE_USER");
	ok(a.authorized_for_configuration_information == FALSE, "an unlisted user gets no configuration information");
	free(a.username);

	unsetenv("REMOTE_USER");
	get_authentication_information(&a);
	ok(a.authenticated == TRUE && !strcmp(a.username, "guest"), "default_user_name applies without REMOTE_USER");
	free(a.username);

	get_authentication_information_for_user(&a, "root");
	ok(a.authenticated == TRUE && a.authorized_for_all_hosts == TRUE
		&& a.authorized_for_configuration_information == TRUE
		&& a.authorized_for_all_services == FALSE,
		"get_authentication_information_for_user() applies that user's cgi.cfg entries");
	free(a.username);

	get_authentication_information_for_user(&a, "");
	ok(a.authenticated == FALSE, "an empty user name is not authenticated");
	free(a.username);

	/* --- the reasons of each rule --- */
	expect(explain("alice", host_direct, NULL), "TRUE contact", "direct host contact");
	expect(explain("bob", host_group_member, NULL), "TRUE contactgroup:grp_admins", "host contactgroup member");
	expect(explain("dave", host_escalated, NULL), "TRUE host_escalation", "host escalation contact");
	expect(explain("root", host_unrelated, NULL), "TRUE all_hosts_user", "authorized_for_all_hosts by user name (not a contact)");
	expect(explain("opsuser", host_unrelated, NULL), "TRUE all_hosts_contactgroup:grp_ops", "authorized_contactgroup_for_all_hosts");
	expect(explain("alice", host_unrelated, NULL), "FALSE", "unrelated contact is denied");
	expect(explain("viewer", host_unrelated, NULL), "FALSE", "read-only flag alone grants no view");
	expect(explain("carol", host_direct, NULL), "TRUE all_hosts_user", "a contact listed in authorized_for_all_hosts");

	expect(explain("alice", NULL, svc1), "TRUE host:contact", "service seen through its host's contact");
	expect(explain("carol", NULL, svc2), "TRUE host:all_hosts_user contact",
		"all reasons are listed when several rules match");
	expect(explain("frank", NULL, svc_cg), "TRUE contactgroup:grp_svc", "service contactgroup member");
	expect(explain("gina", NULL, svc_esc), "TRUE service_escalation", "service escalation contact");
	expect(explain("svcadmin", NULL, svc2), "TRUE all_services_user", "authorized_for_all_services by user name");
	expect(explain("svcadmin", host_unrelated, NULL), "FALSE", "all services does not imply the host");
	expect(explain("frank", NULL, svc2), "FALSE", "unrelated service is denied");
	expect(explain("frank", host_unrelated, NULL), "FALSE", "service contact does not see the host");

	/* --- what no user in particular gets --- */
	get_authentication_information_for_anyone(&a);
	auth_reasons_init(&r);
	ok(explain_host_authorization(host_unrelated, &a, &r) == FALSE && r.count == 0, "without wildcards an arbitrary user sees nothing");
	auth_reasons_free(&r);
	free(a.username);

	sweep("named users");

	/* --- "*" wildcards --- */
	write_cgi_cfg(
		"authorized_for_all_hosts=*\n"
		"authorized_for_all_services=alice,*\n");

	get_authentication_information_for_anyone(&a);
	auth_reasons_init(&r);
	ok(explain_host_authorization(host_unrelated, &a, &r) == TRUE, "authorized_for_all_hosts=* lets any user see a host");
	expect(joined(&r), "all_hosts_wildcard", "...because of the wildcard");
	auth_reasons_free(&r);
	auth_reasons_init(&r);
	explain_service_authorization(svc2, &a, &r);
	expect(joined(&r), "all_services_wildcard host:all_hosts_wildcard", "a service gets both wildcards");
	auth_reasons_free(&r);
	free(a.username);

	expect(explain("alice", NULL, svc1), "TRUE all_services_user all_services_wildcard host:all_hosts_wildcard host:contact",
		"named and wildcard entries are both reported");

	names = get_auth_candidate_users(&name_count);
	for(i = 0; i < name_count; i++) {
		if(!strcmp(names[i], "*"))
			break;
		}
	ok(i == name_count, "\"*\" is never a candidate user name");
	free_auth_candidate_users(names, name_count);

	sweep("wildcards");

	/* --- use_authentication=0 --- */
	write_cgi_cfg("");
	use_authentication = FALSE;
	expect(explain("alice", host_unrelated, NULL), "TRUE authentication_disabled", "authentication disabled lets everyone see hosts");
	expect(explain("nobody", NULL, svc2), "TRUE authentication_disabled", "...and services, even for a non-contact");
	sweep("authentication disabled");
	use_authentication = TRUE;

	unlink(cgi_cfg_path);

	return exit_status();
	}
