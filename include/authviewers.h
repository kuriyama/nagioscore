/*****************************************************************************
 *
 * AUTHVIEWERS.H - Explain who may view a host/service and why
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

#ifndef NAGIOS_AUTHVIEWERS_H_INCLUDED
#define NAGIOS_AUTHVIEWERS_H_INCLUDED
#include "common.h"
#include "objects.h"
#include "cgiauth.h"

NAGIOS_BEGIN_DECL

/* reason strings explaining a view authorization, e.g. "contact",
   "contactgroup:admins", "all_hosts_wildcard", "host:host_escalation" */
typedef struct auth_reasons_struct {
	char **items;
	int count;
	} auth_reasons;

void auth_reasons_init(auth_reasons *);
void auth_reasons_free(auth_reasons *);

/* The returned value is always the decision of is_authorized_for_host()/
   is_authorized_for_service(); the reasons are annotations only. A TRUE
   decision that no known rule explains gets the reason "unknown". */
int explain_host_authorization(host *, authdata *, auth_reasons *);
int explain_service_authorization(service *, authdata *, auth_reasons *);

/* Every user name that could log in and get some authorization: all
   contacts plus the names listed in the CGI config file's authorized_for_*
   and default_user_name entries. Sorted and unique. */
char **get_auth_candidate_users(int *);
void free_auth_candidate_users(char **, int);

/* Build the authdata of an authenticated user that no contact definition
   or CGI config entry names, i.e. what the "*" wildcards alone grant. */
int get_authentication_information_for_anyone(authdata *);

NAGIOS_END_DECL

#endif
