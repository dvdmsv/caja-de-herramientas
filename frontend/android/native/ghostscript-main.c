/* Lanzador local: límites independientes del proceso de la interfaz Android. */
#include <sys/resource.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <signal.h>
#include <unistd.h>
#include "iapi.h"

int main(int argc, char **argv) {
    pid_t parent=getppid();
    if(parent==1 || prctl(PR_SET_PDEATHSIG,SIGKILL) || getppid()!=parent)return 125;
    struct rlimit cpu = {180, 181}, file = {250ULL*1024*1024, 250ULL*1024*1024};
    if (setrlimit(RLIMIT_CPU, &cpu) || setrlimit(RLIMIT_FSIZE, &file)) return 125;
    void *instance = NULL;
    int code = gsapi_new_instance(&instance, NULL);
    if (code < 0) return 1;
    gsapi_set_arg_encoding(instance, GS_ARG_ENCODING_UTF8);
    code = gsapi_init_with_args(instance, argc, argv);
    int end = gsapi_exit(instance);
    gsapi_delete_instance(instance);
    /* gs_error_Quit (-101) es la salida normal al utilizar -dBATCH. */
    return (code == 0 || code == -101) && end >= 0 ? 0 : 1;
}
