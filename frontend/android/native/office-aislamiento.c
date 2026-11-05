#include <jni.h>
#include <stddef.h>
#include <errno.h>
#include <unistd.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <linux/seccomp.h>
#include <linux/filter.h>

/* El proceso Office no necesita red; la TSA vive en el proceso principal. */
JNIEXPORT jboolean JNICALL Java_io_github_dvdmsv_cajadeherramientas_OfficeService_aislarRed(JNIEnv* env,jclass cls) {
 (void)env;(void)cls;
 struct sock_filter code[]={
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
#ifdef __NR_connect
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_connect,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EACCES),
#endif
#ifdef __NR_sendto
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_sendto,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EACCES),
#endif
#ifdef __NR_sendmsg
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_sendmsg,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EACCES),
#endif
#ifdef __NR_sendmmsg
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_sendmmsg,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EACCES),
#endif
#ifdef __NR_socketcall
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_socketcall,0,1),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EACCES),
#endif
  BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
 };
 struct sock_fprog program={(unsigned short)(sizeof(code)/sizeof(code[0])),code};
 if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)!=0)return JNI_FALSE;
 return syscall(__NR_seccomp,SECCOMP_SET_MODE_FILTER,SECCOMP_FILTER_FLAG_TSYNC,&program)==0?JNI_TRUE:JNI_FALSE;
}
