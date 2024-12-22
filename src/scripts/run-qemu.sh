#!/bin/bash
# shellcheck disable=SC2086
# shellcheck disable=SC2089
# shellcheck disable=SC2090

function usage() {
    echo "Usage: $0 [OPTION]"
    echo
    echo "Options:"
    echo "  -n, --dry-run           do not run, just print"
    echo "  -dk                     launch qemu to debug linux kernel"
    echo "  -dq                     launch gdbserver to debug qemu"
    echo
    echo "  -myqemu                 use my qemu"
    echo "  -initrd                 use alpine initrd"
    echo "  -nodev                  no devices"
    echo
    echo "  -b, --boot-args <ARGS>  additional kernel command line parameters"
    echo "                          e.g. -b 'memmap=100M@2G,100M#3G,1G!1024G'"
    echo "  -c, --cpus <NUMS>       cpu nums, e.g. -c 4"
    echo "  -i, --id <NUM>          id"
    echo "  -p, --pin               pin vcpus"
    echo "  -m, --mem <SIZE>        mem size, e.g. -m 8G"
    echo "  -q, --quiet             add \"quiet\" to kernel command line"
    echo "  -t, --trace <EVENTS>    add trace, can use multiple -t option"
    echo "                          e.g. -t 'sched:*,kmem:kmalloc' -t 'net:*'"
    echo "  -h, --help              display help"
    echo "  -e, --extra <OPTION>    extra qemu option"
    echo
    echo "Suggestion:"
    echo "  alias rq=\"$0\""
    exit 1
}

# TODO
# - nvdimm
# - 预定义一些 trace events，比如弄个 TRACE_RCU 变量，再弄个 --trace-rcu 选项
# - numa 参考 https://www.qemu.org/docs/master/system/invocation.html 里 -numa 一节的示例
# - 看 seabios 的日志，见 Martins3.github.io/docs/qemu/sh/alpine.sh
# - 支持启动多个 qemu
# - 支持指定网卡数量

QEMU=qemu-system-x86_64

CPUS=4
MEM_SIZE=8G
KERNEL=/data/os-code/linux/out/x86_64/vmlinux
# KERNEL=/data/os-code/linux/out/x86_64/arch/x86/boot/bzImage
# KERNEL=/data/VMs/fedora_rootfs/boot/vmlinuz-6.8.5-301.fc40.x86_64

INITRD=/data/VMs/alpine-minirootfs.img

EXTRA_QEMU_ARGS=

DISK1_FILE=/data/VMs/fc38_vm0.qcow2

VIRTIOFSD_SOCKET=/tmp/vfsd.sock

QEMU_SRC_DIR=/data/os-code/qemu

# 当前所执行脚本所在目录
SCRIPTS_DIR=$(dirname $0)

if [ ! -f /tmp/rq.flag ]; then
    sudo chmod 777 /dev/hugepages/
    # 为啥用 1G 大页启动虚拟机反而会变慢？不应该更快吗？内核有bug？
    echo 8192 | sudo tee /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages >/dev/null

    sudo sh $SCRIPTS_DIR/setup-network.sh

    touch /tmp/rq.flag
    echo "init done"
fi

ID=0
QMP=1
VERBOSE=1
PIN=0

RUN=1
GDB_KERNEL=0
GDB_QEMU=0

ALL_DEVICE=1
USE_INITRD=0

VIRTIO_MODERN_OPTS="disable-legacy=on,disable-modern=off"

###
###

KERNEL_CMDLINE="nokaslr selinux=0 audit=0"
function append_kernel_cmdline() {
    KERNEL_CMDLINE="$KERNEL_CMDLINE $*"
}
append_kernel_cmdline console=ttyS0 # earlyprintk=serial # 这个选项有啥作用

TRACE_ARGS=""
function append_trace_args() {
    TRACE_ARGS="$TRACE_ARGS$*,"
}

while (("$#")); do
    case "$1" in
    -myqemu)
        QEMU=$QEMU_SRC_DIR/build/$QEMU
        shift
        ;;
    -initrd)
        USE_INITRD=1
        shift
        ;;
    -nodev)
        ALL_DEVICE=0
        shift
        ;;
    -dk)
        GDB_KERNEL=1
        shift
        ;;
    -dq)
        GDB_QEMU=1
        shift
        ;;
    -n | --dry-run)
        RUN=0
        shift
        ;;
    -b | --boot-args)
        append_kernel_cmdline $2
        shift 2
        ;;
    -c | --cpus)
        CPUS=$2
        shift 2
        ;;
    -i | --id)
        ID=$2
        shift 2
        ;;
    -e | --extra)
        EXTRA_QEMU_ARGS+=" $2"
        shift 2
        ;;
    -p | --pin)
        PIN=1
        shift
        ;;
    -m | --mem)
        MEM_SIZE=$2
        shift 2
        ;;
    -q | --quiet)
        VERBOSE=0
        shift
        ;;
    -t | --trace)
        append_trace_args $2
        shift 2
        ;;
    -h | --help)
        usage
        ;;
    *)
        echo "Error: Unsupported flag: $*" >&2
        usage
        ;;
    esac
done

# 必须要打印，否则 vscode debug kernel 时，要等很久？？？
echo "=== start ==="

###
###
###

if [ $VERBOSE -eq 0 ]; then
    append_kernel_cmdline quiet
fi

if [ -n "$TRACE_ARGS" ]; then
    append_kernel_cmdline trace_event=$TRACE_ARGS
fi

if [ $QMP -eq 1 ]; then
    QMP_ARGS="-qmp unix:/tmp/qmp-sock-$ID,server,nowait"
fi

###
### Setup machine, cpu, memory, disk, network
###

# https://wiki.archlinux.org/title/QEMU#Booting_in_UEFI_mode
# UEFI 需要可写内存。所以要有 /data/VMs/OVMF_VARS.4m.fd
UEFI_ARGS="
-drive if=pflash,format=raw,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.4m.fd
-drive if=pflash,format=raw,file=/data/VMs/OVMF_VARS.4m.fd
"
# TODO 用 OVMF 时，不能直接用 vmlinux（用 bzImage 没问题），所以这里用 seabios
# 根据 https://wiki.archlinux.org/title/QEMU#Booting_in_UEFI_mode
BIOS=/usr/share/qemu/bios-256k.bin
UEFI_ARGS="-bios $BIOS"

# seabios 的日志，为什么是空的
# UEFI_ARGS+=" -chardev file,path=/tmp/seabios.log,id=seabios -device isa-debugcon,iobase=0x402,chardev=seabios"

# microvm 不支持 uefi pcie 什么的，所以用 q35
MACHINE_ARGS="
-machine q35,accel=kvm,sata=off,smbus=off,usb=off,kernel-irqchip=split
"

IOMMU_ARGS="
-device intel-iommu,intremap=on,device-iotlb=on
"
append_kernel_cmdline iommu=pt intel_iommu=on

# 2 个 socket，每个 core 2 个 thread，最多 hot-plug 到 16 个
CPU_ARGS="
-cpu host
-smp $CPUS,sockets=2,dies=1,clusters=1,threads=2,maxcpus=16
"

# TODO MEM_SIZE/2
# prealloc=on 会导致 qemu 启动慢几秒
MEM_ARGS="
-m $MEM_SIZE
-object memory-backend-file,id=ram-node0,size=4G,mem-path=/dev/hugepages,share=on,prealloc=off
-object memory-backend-file,id=ram-node1,size=4G,mem-path=/dev/hugepages,share=on,prealloc=off
-numa node,nodeid=0,cpus=0-1,cpus=4-9,memdev=ram-node0
-numa node,nodeid=1,cpus=2-3,cpus=10-15,memdev=ram-node1
"

NET_ARGS+="
-netdev tap,id=net0,ifname=tap0,script=no,downscript=no,vhost=on
-device virtio-net-pci,netdev=net0,$VIRTIO_MODERN_OPTS,bus=pcie.0,addr=0x1.0
"
NET_ARGS+="
-netdev tap,id=net1,ifname=tap1,script=no,downscript=no,vhost=on
-device virtio-net-pci,netdev=net1,$VIRTIO_MODERN_OPTS,bus=pcie.0,addr=0x2.0,iommu_platform=on
"

DISK_ARGS+="
-blockdev driver=qcow2,node-name=disk1,file.driver=file,file.filename=$DISK1_FILE
-device virtio-blk-pci,drive=disk1,$VIRTIO_MODERN_OPTS,bus=pcie.0,addr=0x3.0
"
# -drive if=virtio,format=qcow2,file=$DISK1_FILE

VIRTIOFS_ARGS="
-chardev socket,id=char0,path=$VIRTIOFSD_SOCKET
-device vhost-user-fs-pci,chardev=char0,tag=myfs,bus=pcie.0,addr=0x4.0
"
append_kernel_cmdline rootfstype=virtiofs root=myfs rw

###
### Run QEMU
###

# Helper to pin all vCPU threads to different CPUs so that RT works as expected.
function pin_vcpu_threads() {
    echo "Pinning all vCPU threads to different CPUs for RT, waiting for 5 secs"
    sleep 5

    # 起始 cpu 为 4
    cpu=4
    # 将每个线程都 pin 到不同的 cpu
    for tid in $(pgrep -w qemu-system-x86); do
        echo "Pinning thread $tid to CPU $cpu for RT"
        taskset -cp $cpu $tid
        cpu=$((cpu + 1))
    done
}
# For rt-testing, pass -rt to run hypervisor as highest prio FF
if [ $PIN -eq 1 ]; then
    chrt -f -p 99 $$
    pin_vcpu_threads & # Run in bg to give time for qemu to start
fi

QEMU_CMD="
$QEMU
-nodefaults
-kernel $KERNEL
-append '$KERNEL_CMDLINE'
$UEFI_ARGS
$MACHINE_ARGS
$CPU_ARGS
$MEM_ARGS
$QMP_ARGS
-nographic
-serial mon:stdio
-pidfile /tmp/qemu-$ID.pid
$EXTRA_QEMU_ARGS
"

# TODO https://fadeevab.com/how-to-setup-qemu-output-to-console-and-automate-using-shell-script/

if [ $USE_INITRD -eq 1 ]; then
    QEMU_CMD+="-initrd $INITRD"
fi

if [ $ALL_DEVICE -eq 1 ]; then
    QEMU_CMD+="
    $VIRTIOFS_ARGS
    $DISK_ARGS
    $NET_ARGS
    $IOMMU_ARGS
    "
fi

export LD_LIBRARY_PATH="/data/os-code/rdma-core/build/lib"

if [ $GDB_QEMU -eq 1 ]; then
    eval gdbserver localhost:1234 $QEMU_CMD
    # eval gdb -ex \"handle SIGUSR1 nostop noprint\" -ex \"set debuginfod enabled off\" --args $QEMU_CMD
elif [ $GDB_KERNEL -eq 1 ]; then
    # -s 相当于 -gdb tcp::1234
    # -S 在启动时暂停
    eval exec $QEMU_CMD -s -S
elif [ $RUN -eq 1 ]; then
    eval exec $QEMU_CMD
else
    echo $QEMU_CMD
fi
