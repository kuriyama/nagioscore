/*****************************************************************************
 *
 * AUTHVIEWERS.C - Explain who may view a host/service and why
 *
 *
 * License:
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 2 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.
 *
 *****************************************************************************/

/*
 * The authorization decisions themselves stay in cgiauth.c. This file only
 * labels them: every explain_*() returns what is_authorized_for_*() says,
 * and walks the same rules alongside to record which of them matched.
 */

#include "../include/config.h"
#include "../include/common.h"
#include "../include/objects.h"
#include "../include/cgiauth.h"
#include "../include/authviewers.h"

extern int use_authentication;
extern contact *contact_list;

/* a user name no contact definition or CGI config entry can match: CGI
   config values never contain a newline */
#define ANYONE_USERNAME "\n*anyone*"


void auth_reasons_init(auth_reasons *r) {
	r->items = NULL;
	r->count = 0;
	}


void auth_reasons_free(auth_reasons *r) {
	int x;

	for(x = 0; x < r->count; x++)
		free(r->items[x]);
	free(r->items);
	auth_reasons_init(r);
	}


static void add_reason(auth_reasons *r, const char *prefix, const char *reason, const char *detail) {
	char *item = NULL;
	char **new_items = NULL;
	int x;

	if(asprintf(&item, "%s%s%s%s", prefix ? prefix : "", reason,
			detail ? ":" : "", detail ? detail : "") < 0)
		return;

	/* the same reason can come from several config lines */
	for(x = 0; x < r->count; x++) {
		if(!strcmp(r->items[x], item)) {
			free(item);
			return;
			}
		}

	if((new_items = realloc(r->items, (r->count + 1) * sizeof(char *))) == NULL) {
		free(item);
		return;
		}
	r->items = new_items;
	r->items[r->count++] = item;
	}


/* does the comma separated value of "key=value" contain name? */
static int config_list_contains(const char *line, const char *key, const char *name) {
	const char *p;
	size_t name_len = strlen(name);

	if(strncmp(line, key, strlen(key)))
		return FALSE;
	for(p = line + strlen(key); *p != '\x0';) {
		const char *end = strchr(p, ',');
		size_t len = end ? (size_t)(end - p) : strlen(p);
		if(len == name_len && !strncmp(p, name, len))
			return TRUE;
		if(end == NULL)
			break;
		p = end + 1;
		}
	return FALSE;
	}


/* record why authorized_for_all_<what> is set: the user listed by name,
   the "*" wildcard, or membership of a listed contactgroup */
static void explain_global_flag(authdata *authinfo, const char *what, const char *prefix, auth_reasons *r) {
	char user_key[64];
	char cg_key[64];
	char reason[64];
	char **lines;
	int line_count, x;
	contact *temp_contact = find_contact(authinfo->username);

	snprintf(user_key, sizeof(user_key), "authorized_for_%s=", what);
	snprintf(cg_key, sizeof(cg_key), "authorized_contactgroup_for_%s=", what);

	lines = get_auth_config_lines(&line_count);
	for(x = 0; x < line_count; x++) {
		if(config_list_contains(lines[x], user_key, authinfo->username)) {
			snprintf(reason, sizeof(reason), "%s_user", what);
			add_reason(r, prefix, reason, NULL);
			}
		if(config_list_contains(lines[x], user_key, "*")) {
			snprintf(reason, sizeof(reason), "%s_wildcard", what);
			add_reason(r, prefix, reason, NULL);
			}
		if(temp_contact != NULL && !strncmp(lines[x], cg_key, strlen(cg_key))) {
			char *copy = strdup(lines[x] + strlen(cg_key));
			char *saveptr = NULL;
			char *name;
			if(copy == NULL)
				continue;
			for(name = strtok_r(copy, ",", &saveptr); name != NULL; name = strtok_r(NULL, ",", &saveptr)) {
				if(is_contact_member_of_contactgroup(find_contactgroup(name), temp_contact)) {
					snprintf(reason, sizeof(reason), "%s_contactgroup", what);
					add_reason(r, prefix, reason, name);
					}
				}
			free(copy);
			}
		}
	}


static void explain_object_contacts(contactsmember *contacts, contactgroupsmember *groups,
		contact *temp_contact, const char *prefix, auth_reasons *r) {
	contactsmember *temp_contactsmember;
	contactgroupsmember *temp_contactgroupsmember;

	for(temp_contactsmember = contacts; temp_contactsmember != NULL; temp_contactsmember = temp_contactsmember->next) {
		if(temp_contactsmember->contact_ptr == temp_contact)
			add_reason(r, prefix, "contact", NULL);
		}
	for(temp_contactgroupsmember = groups; temp_contactgroupsmember != NULL; temp_contactgroupsmember = temp_contactgroupsmember->next) {
		if(is_contact_member_of_contactgroup(temp_contactgroupsmember->group_ptr, temp_contact))
			add_reason(r, prefix, "contactgroup", temp_contactgroupsmember->group_name);
		}
	}


static void explain_host_rules(host *hst, authdata *authinfo, const char *prefix, auth_reasons *r) {
	contact *temp_contact;

	if(authinfo->authorized_for_all_hosts == TRUE)
		explain_global_flag(authinfo, "all_hosts", prefix, r);

	if((temp_contact = find_contact(authinfo->username)) == NULL)
		return;

	explain_object_contacts(hst->contacts, hst->contact_groups, temp_contact, prefix, r);
	if(is_escalated_contact_for_host(hst, temp_contact) == TRUE)
		add_reason(r, prefix, "host_escalation", NULL);
	}


int explain_host_authorization(host *hst, authdata *authinfo, auth_reasons *r) {
	int result = is_authorized_for_host(hst, authinfo);

	if(hst == NULL)
		return result;

	if(use_authentication == FALSE)
		add_reason(r, NULL, "authentication_disabled", NULL);
	else if(result == TRUE)
		explain_host_rules(hst, authinfo, NULL, r);

	if(result == TRUE && r->count == 0)
		add_reason(r, NULL, "unknown", NULL);

	return result;
	}


int explain_service_authorization(service *svc, authdata *authinfo, auth_reasons *r) {
	int result = is_authorized_for_service(svc, authinfo);
	host *temp_host;
	contact *temp_contact;

	if(svc == NULL)
		return result;

	if(use_authentication == FALSE)
		add_reason(r, NULL, "authentication_disabled", NULL);
	else if(result == TRUE) {
		if(authinfo->authorized_for_all_services == TRUE)
			explain_global_flag(authinfo, "all_services", NULL, r);

		/* authorization for the host extends to all of its services */
		temp_host = find_host(svc->host_name);
		if(temp_host != NULL && is_authorized_for_host(temp_host, authinfo) == TRUE)
			explain_host_rules(temp_host, authinfo, "host:", r);

		if((temp_contact = find_contact(authinfo->username)) != NULL) {
			explain_object_contacts(svc->contacts, svc->contact_groups, temp_contact, NULL, r);
			if(is_escalated_contact_for_service(svc, temp_contact) == TRUE)
				add_reason(r, NULL, "service_escalation", NULL);
			}
		}

	if(result == TRUE && r->count == 0)
		add_reason(r, NULL, "unknown", NULL);

	return result;
	}


static int compare_names(const void *a, const void *b) {
	return strcmp(*(char * const *)a, *(char * const *)b);
	}


static void add_candidate(char ***names, int *count, int *alloc, const char *name) {
	char **new_names;

	if(name == NULL || name[0] == '\x0' || !strcmp(name, "*"))
		return;
	if(*count == *alloc) {
		int new_alloc = *alloc ? *alloc * 2 : 64;
		if((new_names = realloc(*names, new_alloc * sizeof(char *))) == NULL)
			return;
		*names = new_names;
		*alloc = new_alloc;
		}
	if(((*names)[*count] = strdup(name)) != NULL)
		(*count)++;
	}


char **get_auth_candidate_users(int *count) {
	char **names = NULL;
	char **lines;
	int alloc = 0, line_count, x, y;
	contact *temp_contact;

	*count = 0;

	for(temp_contact = contact_list; temp_contact != NULL; temp_contact = temp_contact->next)
		add_candidate(&names, count, &alloc, temp_contact->name);

	/* user names listed directly in the CGI config file (contactgroup
	   entries only ever reach users that are contacts already) */
	lines = get_auth_config_lines(&line_count);
	for(x = 0; x < line_count; x++) {
		char *value, *copy, *saveptr = NULL, *name;
		if(strncmp(lines[x], "authorized_for_", 15) && strncmp(lines[x], "default_user_name=", 18))
			continue;
		if((value = strchr(lines[x], '=')) == NULL)
			continue;
		if((copy = strdup(value + 1)) == NULL)
			continue;
		for(name = strtok_r(copy, ",", &saveptr); name != NULL; name = strtok_r(NULL, ",", &saveptr))
			add_candidate(&names, count, &alloc, name);
		free(copy);
		}

	if(*count == 0)
		return names;

	qsort(names, *count, sizeof(char *), compare_names);
	for(x = 1, y = 0; x < *count; x++) {
		if(!strcmp(names[x], names[y]))
			free(names[x]);
		else
			names[++y] = names[x];
		}
	*count = y + 1;

	return names;
	}


void free_auth_candidate_users(char **names, int count) {
	int x;

	for(x = 0; x < count; x++)
		free(names[x]);
	free(names);
	}


int get_authentication_information_for_anyone(authdata *authinfo) {
	return get_authentication_information_for_user(authinfo, ANYONE_USERNAME);
	}
