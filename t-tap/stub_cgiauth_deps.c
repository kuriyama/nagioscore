/* Stubs for the handful of object-graph dependent symbols cgi/cgiauth.o
   needs to link that test_cgiauth.c does not itself exercise: the
   host/service/hostgroup/servicegroup-based authorization checks
   (is_authorized_for_host() and friends) are out of scope for this test
   (they need a populated object graph -- find_host()/find_contact() etc.,
   already stubbed in stub_objects.c, plus fixture host/contact objects),
   so their own downstream dependencies are stubbed out here rather than
   linking the real common/objects.c. */

int is_contact_for_host(host *hst, contact *cntct)
{ return FALSE; }

int is_contact_for_service(service *svc, contact *cntct)
{ return FALSE; }

int is_escalated_contact_for_host(host *hst, contact *cntct)
{ return FALSE; }

int is_escalated_contact_for_service(service *svc, contact *cntct)
{ return FALSE; }

int is_contact_member_of_contactgroup(contactgroup *group, contact *cntct)
{ return FALSE; }

const char *get_cgi_config_location(void)
{ return "/dev/null"; }
