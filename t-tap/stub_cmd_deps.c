/* Stubs for cgi/cmd.c's dependencies that test_cmd.c does not itself
   exercise. test_cmd.c only tests write_command_to_file()'s newline
   defense and clean_comment_data()'s ';'-stripping, both pure
   string/file-handling logic with no dependency on a populated
   object graph, CGI environment, or authentication state -- but
   linking the real cgi/cmd.o (so the test exercises the actual
   shipped code, not a copy) pulls in every symbol cmd.c references
   anywhere in the file, regardless of which functions are actually
   called here. Everything below is dead weight for this test's
   purposes: never invoked, just present so the linker is happy.

   This file is #include'd directly into test_cmd.c (matching this
   directory's established stub_*.c convention), so it relies on
   test_cmd.c's own includes rather than including its headers again
   -- include/getcgi.h in particular has no include guard, so a
   second #include of it in the same translation unit is a hard
   error, not just redundant. */

/* Plain globals cmd.c declares extern and expects a definition for */
char main_config_file[MAX_FILENAME_LENGTH] = "";
char url_html_path[MAX_FILENAME_LENGTH] = "";
char url_images_path[MAX_FILENAME_LENGTH] = "";
char command_file[MAX_FILENAME_LENGTH] = "";
char url_stylesheets_path[MAX_FILENAME_LENGTH] = "";
int nagios_process_state = 0;
int use_authentication = FALSE;
int lock_author_names = FALSE;
int ack_no_sticky = FALSE;
int ack_no_send = FALSE;
int date_format = 0;
int check_external_commands = TRUE;
scheduled_downtime *scheduled_downtime_list = NULL;

/* Object-graph lookups (host/service/hostgroup/servicegroup/comment
   already stubbed to NULL elsewhere in t-tap via stub_objects.c /
   stub_downtime.c; comment lookups are cmd.c-specific, not stubbed
   anywhere else yet) */
struct nagios_comment *find_service_comment(unsigned long id) { return NULL; }
struct nagios_comment *find_host_comment(unsigned long id) { return NULL; }

/* Authorization gate -- always deny, since no test here exercises an
   authorized code path */
int get_authentication_information(authdata *a) { return OK; }
int is_authorized_for_system_commands(authdata *a) { return FALSE; }
int is_authorized_for_host_commands(host *h, authdata *a) { return FALSE; }
int is_authorized_for_service_commands(service *s, authdata *a) { return FALSE; }
int is_authorized_for_hostgroup_commands(hostgroup *hg, authdata *a) { return FALSE; }
int is_authorized_for_servicegroup_commands(servicegroup *sg, authdata *a) { return FALSE; }
int is_authorized_for_read_only(authdata *a) { return TRUE; }

/* CGI/config plumbing */
char **getcgivars(void) { return NULL; }
void free_cgivars(char **cgivars) { }
void init_shared_cfg_vars(int status) { }
void reset_cgi_vars(void) { }
/* NOTE: this is cgiutils.h's CGI-side free_memory(void), a distinct
   function from base/'s free_memory(nagios_macros *) -- do not pull
   in t-tap's existing stub_utils.c here, it stubs the other one and
   won't even compile under -DNSCGI (nagios_macros isn't in scope). */
void free_memory(void) { }
int read_cgi_config_file(const char *f, read_config_callback cb) { return OK; }
int read_main_config_file(const char *f) { return OK; }
int read_all_object_configuration_data(const char *f, int opts) { return OK; }
void strip_html_brackets(char *buffer) { }
void get_time_string(time_t *t, char *buf, int len, int type) { if (len > 0) buf[0] = '\0'; }
char *escape_string(const char *input) { return strdup(input ? input : ""); }
void display_info_table(const char *title, int refresh, authdata *a) { }
void include_ssi_files(const char *name, int where) { }
void cgi_config_file_error(const char *f) { }
void main_config_file_error(const char *f) { }
void object_data_error(void) { }
void display_context_help(const char *link) { }
struct nagios_extcmd *extcmd_get_command_id(int id) { return NULL; }
struct nagios_extcmd *extcmd_get_command_name(const char *name) { return NULL; }
const char *extcmd_get_name(int id) { return ""; }
const char *get_cgi_config_location(void) { return "/dev/null"; }
