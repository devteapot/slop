cask "slop-desktop" do
  version "0.1.0"

  on_arm do
    url "https://github.com/devteapot/slop/releases/download/desktop-v#{version}/SLOP.Desktop_#{version}_aarch64.dmg"
    sha256 :no_check # TODO: update with actual sha256 after first release
  end

  on_intel do
    url "https://github.com/devteapot/slop/releases/download/desktop-v#{version}/SLOP.Desktop_#{version}_x64.dmg"
    sha256 :no_check # TODO: update with actual sha256 after first release
  end

  name "SLOP Desktop"
  desc "AI-powered desktop client for the SLOP protocol"
  homepage "https://slopai.dev"

  app "SLOP Desktop.app"

  zap trash: [
    "~/Library/Application Support/com.slop.desktop",
    "~/Library/Caches/com.slop.desktop",
    "~/Library/Preferences/com.slop.desktop.plist",
    "~/.slop",
  ]
end
