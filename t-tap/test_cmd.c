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
 * cgi/cmd.c is cmd.cgi's command-submission logic: POST data ends up
 * written to Nagios's external command pipe and re-parsed there by the
 * core daemon. This test covers only the two small, self-contained,
 * security-relevant pieces of it that don't need a populated
 * host/service/contact object graph or a live CGI/auth environment:
 *
 *   - write_command_to_file(): the single, global, last-mile defense
 *     against command-pipe injection via an embedded newline (a crafted
 *     comment/author/etc. field containing '\n' could otherwise smuggle
 *     in a second, unintended external command -- see the code comment
 *     at its call site: "malicious users... bypass the
 *     access-restrictions").
 *   - clean_comment_data(): strips ';' from comment_data/comment_author
 *     before they reach command construction (';' is the external
 *     command's own field separator; commit_command() rejects a literal
 *     ';' in every OTHER field, but comment_data/comment_author rely on
 *     this function instead, since free-text comments legitimately want
 *     to contain most other punctuation).
 *
 * This deliberately does NOT cover commit_command()/commit_command_data()
 * (the command-type dispatch itself) or any of the object-graph-aware
 * authorization checks -- cgi/cmd.c references ~40 external symbols
 * (find_host/find_service/is_authorized_for_*_commands/CGI config
 * loading/etc.), and properly exercising the dispatch logic would need
 * real host/service/contact fixtures, not just stubs returning fixed
 * values (the same scoping call test_cgiauth.c made for cgiauth.c's
 * object-graph-dependent half). See notes/cmd-cgi-tests-2026-09-23.md
 * for what that would take.
 *
 * The real cgi/cmd.o is linked directly (not reimplemented) so this
 * test exercises the actual shipped code; stub_cmd_deps.c supplies
 * definitions for everything else cmd.o references but this test
 * doesn't exercise.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "../include/config.h"
#include "../include/common.h"
#include "../include/objects.h"
#include "../include/comments.h"
#include "../include/downtime.h"
#include "../include/cgiutils.h"
#include "../include/cgiauth.h"
#include "../include/getcgi.h"
#include "tap.h"

#include "stub_objects.c"
#include "stub_downtime.c"
#include "stub_comments.c"
#include "stub_cmd_deps.c"

extern int write_command_to_file(char *cmd);
extern void clean_comment_data(char *buffer);
extern char command_file[MAX_FILENAME_LENGTH];

static char *read_whole_file(const char *path) {
	FILE *fp;
	static char buf[4096];
	size_t n;

	fp = fopen(path, "r");
	if (fp == NULL) {
		return NULL;
	}
	n = fread(buf, 1, sizeof(buf) - 1, fp);
	buf[n] = '\0';
	fclose(fp);
	return buf;
	}

int
main() {
	char tmpl[] = "/tmp/test_cmd_pipe.XXXXXX";
	int fd;

	plan_tests(17);

	/* --- write_command_to_file(): the newline-injection defense --- */

	/* NULL/empty are rejected before ever touching the filesystem */
	ok(write_command_to_file(NULL) == ERROR, "write_command_to_file(NULL) is rejected");
	ok(write_command_to_file("") == ERROR, "write_command_to_file(\"\") is rejected");

	/* the actual security property: ANY embedded newline is rejected,
	   regardless of where in the string it appears */
	ok(write_command_to_file("PROCESS_HOST_CHECK_RESULT;host;0;ok\n") == ERROR,
		"a trailing newline is rejected");
	ok(write_command_to_file("PROCESS_HOST_CHECK_RESULT;host;0;ok\nDISABLE_NOTIFICATIONS") == ERROR,
		"an embedded newline (smuggling a second command) is rejected");
	ok(write_command_to_file("\nPROCESS_HOST_CHECK_RESULT;host;0;ok") == ERROR,
		"a leading newline is rejected");
	ok(write_command_to_file("\n") == ERROR,
		"a bare newline is rejected");

	/* a well-formed command with no newline is accepted and written
	   byte-for-byte (plus the trailing newline write_command_to_file
	   itself appends) -- use a real temp file so this also confirms
	   the function's happy path actually writes what's expected, not
	   just that it returns OK */
	fd = mkstemp(tmpl);
	ok(fd >= 0, "created a temp file to stand in for the command pipe");
	if (fd >= 0) {
		close(fd);
		strncpy(command_file, tmpl, sizeof(command_file) - 1);
		command_file[sizeof(command_file) - 1] = '\0';

		ok(write_command_to_file("PROCESS_HOST_CHECK_RESULT;host;0;ok") == OK,
			"a well-formed command with no newline is accepted");

		{
			char *contents = read_whole_file(tmpl);
			ok(contents != NULL && strcmp(contents, "PROCESS_HOST_CHECK_RESULT;host;0;ok\n") == 0,
				"the accepted command is written verbatim, newline-terminated");
		}

		unlink(tmpl);
		}
	else {
		skip(2, "could not create temp file");
		}

	/* --- clean_comment_data(): ';' stripping --- */

	{
		char buf[64];

		strcpy(buf, "no semicolons here");
		clean_comment_data(buf);
		ok(strcmp(buf, "no semicolons here") == 0,
			"clean_comment_data leaves text with no ';' unchanged");

		strcpy(buf, "a;b;c");
		clean_comment_data(buf);
		ok(strcmp(buf, "a b c") == 0,
			"clean_comment_data replaces every ';' with a space");

		strcpy(buf, ";;;");
		clean_comment_data(buf);
		ok(strcmp(buf, "   ") == 0,
			"clean_comment_data replaces consecutive ';' characters too");

		strcpy(buf, "PROCESS_HOST_CHECK_RESULT;host;0;injected");
		clean_comment_data(buf);
		ok(strchr(buf, ';') == NULL,
			"clean_comment_data removes every ';' from a command-shaped string");

		/* clean_comment_data does not touch newlines -- that's
		   write_command_to_file's job, exercised above. Documenting
		   this here so the division of responsibility between the
		   two functions stays explicit rather than assumed. */
		strcpy(buf, "line one\nline two");
		clean_comment_data(buf);
		ok(strcmp(buf, "line one\nline two") == 0,
			"clean_comment_data does not strip newlines (that's write_command_to_file's job)");

		buf[0] = '\0';
		clean_comment_data(buf);
		ok(strcmp(buf, "") == 0, "clean_comment_data(\"\") stays empty");
	}

	clean_comment_data(NULL);
	ok(1, "clean_comment_data(NULL) does not crash");

	/* length is never changed (only in-place character replacement) */
	{
		char buf[16];
		size_t before;
		strcpy(buf, "a;b;c;d");
		before = strlen(buf);
		clean_comment_data(buf);
		ok(strlen(buf) == before, "clean_comment_data never changes the string length");
	}

	return exit_status();
	}
