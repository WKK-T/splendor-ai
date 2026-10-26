"""Read PE imports/exports without executing Windows binaries on macOS."""
from pathlib import Path
import json
import struct
import sys
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name


class PE:
    def __init__(self,path):
        self.path=path;self.b=path.read_bytes();off=self.u32(0x3c)
        assert self.b[off:off+4]==b'PE\0\0',path
        assert self.u16(off+4)==0x8664,('not x64',path)
        n=self.u16(off+6);size=self.u16(off+20);opt=off+24
        assert self.u16(opt)==0x20b,path
        self.dirs=[(self.u32(opt+112+i*8),self.u32(opt+116+i*8)) for i in range(16)]
        self.sections=[]
        for i in range(n):
            s=opt+size+i*40
            self.sections.append((self.u32(s+12),max(self.u32(s+8),self.u32(s+16)),self.u32(s+20)))
    def u16(self,p):return struct.unpack_from('<H',self.b,p)[0]
    def u32(self,p):return struct.unpack_from('<I',self.b,p)[0]
    def u64(self,p):return struct.unpack_from('<Q',self.b,p)[0]
    def offset(self,rva):
        for va,n,raw in self.sections:
            if va<=rva<va+n:return raw+rva-va
        raise ValueError((self.path,rva))
    def string(self,rva):
        p=self.offset(rva);return self.b[p:self.b.index(b'\0',p)].decode('ascii')
    def imports(self):
        out={}
        for directory,step,ni,ti in [(1,20,12,0),(13,32,4,16)]:
            rva,_=self.dirs[directory]
            if not rva:continue
            d=self.offset(rva)
            while self.u32(d+ni):
                name=self.string(self.u32(d+ni)).lower();trva=self.u32(d+ti)
                if not trva and directory==1:trva=self.u32(d+16)
                p=self.offset(trva);names=[]
                while self.u64(p):
                    t=self.u64(p);p+=8
                    if not t>>63:names.append(self.string(t+2))
                out.setdefault(name,[]).extend(names);d+=step
        return out
    def exports(self):
        rva,_=self.dirs[0]
        if not rva:return set()
        e=self.offset(rva);n=self.u32(e+24);names=self.offset(self.u32(e+32))
        return {self.string(self.u32(names+i*4)) for i in range(n)}


def main(folder):
    runtime=folder/'runtime';bins=[p for p in runtime.rglob('*') if p.suffix.lower() in ('.dll','.pyd','.exe') and 'setuptools' not in p.parts and '_distutils' not in p.parts]
    libraries={p.name.lower():p for p in bins};missing={};symbols={}
    system=set('kernel32.dll kernelbase.dll user32.dll advapi32.dll ws2_32.dll ole32.dll oleaut32.dll ntdll.dll shell32.dll shlwapi.dll crypt32.dll bcrypt.dll bcryptprimitives.dll normaliz.dll version.dll winmm.dll pdh.dll psapi.dll dbghelp.dll msvcrt.dll combase.dll setupapi.dll cfgmgr32.dll imm32.dll gdi32.dll secur32.dll ucrtbase.dll rpcrt4.dll iphlpapi.dll mswsock.dll wintrust.dll winhttp.dll comdlg32.dll comctl32.dll wtsapi32.dll netapi32.dll ncrypt.dll powrprof.dll dwmapi.dll dbgcore.dll dnsapi.dll usp10.dll uxtheme.dll winspool.drv odbc32.dll oledlg.dll msimg32.dll wininet.dll urlmon.dll avrt.dll shcore.dll'.split())
    system.update('cabinet.dll msi.dll mscoree.dll d3d11.dll d3dcompiler_47.dll dxgi.dll propsys.dll oleacc.dll gdiplus.dll imagehlp.dll userenv.dll'.split())
    for path in bins:
        for dll,names in PE(path).imports().items():
            if dll not in libraries and dll not in system and not dll.startswith(('api-ms-','ext-ms-')):
                missing.setdefault(dll,[]).append(str(path.relative_to(runtime)))
            if dll.startswith(('msvcp140','vcruntime140','concrt140')) and dll in libraries:
                exports=PE(libraries[dll]).exports()
                for name in names:
                    if name not in exports:symbols.setdefault(dll,[]).append(name)
    inventory=json.loads((folder/'runtime-components.json').read_text(encoding='utf-8'));versions={canonicalize_name(r['name']):r['version'] for r in inventory}
    env={'os_name':'nt','sys_platform':'win32','platform_system':'Windows','platform_machine':'AMD64','python_version':'3.12','python_full_version':'3.12.10','implementation_name':'cpython','platform_python_implementation':'CPython','extra':''}
    dependencies=[]
    for row in inventory:
        for spec in row.get('requires_dist') or []:
            r=Requirement(spec)
            if r.marker and not r.marker.evaluate(env):continue
            name=canonicalize_name(r.name);assert name in versions,(row['name'],spec)
            assert versions[name] in r.specifier,(row['name'],spec,versions[name]);dependencies.append(str(r))
    result={'pe_x64_binaries':len(bins),'missing_non_system_libraries':missing,'missing_msvc_symbols':symbols,'dependency_edges_checked':len(dependencies),'passed':not missing and not symbols,'windows_execution_performed':False}
    print(json.dumps(result,indent=2))
    # This is structural validation only; the runtime test records execution separately.
    assert result['passed']


if __name__=='__main__':main(Path(sys.argv[1]))
