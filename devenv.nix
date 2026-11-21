{ pkgs, ... }:

{
  packages = with pkgs; [
    git
    pkg-config
    libsecret
  ];

  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_26;
    pnpm.enable = true;
    pnpm.package = pkgs.pnpm_12;
  };
}
