"""Build a VSIX using the standard VS Code package layout; no npm runtime needed."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "package.json").read_text(encoding="utf-8"))
name, version, publisher = (manifest[k] for k in ("name", "version", "publisher"))
output = root / f"{name}-{version}.vsix"
xml = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
<Metadata><Identity Language="en-US" Id="{name}" Version="{version}" Publisher="{publisher}"/><DisplayName>{escape(manifest['displayName'])}</DisplayName><Description xml:space="preserve">{escape(manifest['description'])}</Description><Tags>codex,education</Tags><Categories>Education,Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{manifest['engines']['vscode']}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/></Properties><License>extension/LICENSE</License></Metadata>
<Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/></Assets></PackageManifest>'''
types = '''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="css" ContentType="text/css"/><Default Extension="html" ContentType="text/html"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="" ContentType="text/plain"/></Types>'''
with ZipFile(output, "w", ZIP_DEFLATED) as package:
    package.writestr("extension.vsixmanifest", xml)
    package.writestr("[Content_Types].xml", types)
    for file in [root / "package.json", root / "README.md", root / "README.zh-CN.md", root / "LICENSE", root / "SECURITY.md", root / "CHANGELOG.md", *sorted((root / "src").rglob("*.js")), *sorted((root / "media").glob("*")), *sorted((root / "docs").glob("*.md"))]:
        if file.is_symlink() or not file.is_file():
            raise RuntimeError(f"Refusing non-regular package entry: {file.name}")
        package.write(file, "extension/" + file.relative_to(root).as_posix())
print(output)
