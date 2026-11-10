namespace LontraxAddons;

/// <summary>Things that are the same for everyone using the app.</summary>
static class Config
{
    /// <summary>Client ID of the "Lontrax Addons" GitHub App (Settings > Developer settings > GitHub Apps).
    /// It is not a secret. Until it is filled in, only the LONTRAX_TOKEN test login works.</summary>
    public const string GitHubClientId = "COLOQUE_AQUI_O_CLIENT_ID";

    /// <summary>The private repo that holds catalogo.json (the list of addons the app manages).</summary>
    public const string CatalogRepo = "viniciusvieirafx/Lontrax-Addons";
    public const string CatalogFile = "catalogo.json";
    public const string CatalogRef = "main";

    /// <summary>WoW client folder the addons go to (inside World of Warcraft).</summary>
    public const string WowFlavor = "_forever_";

    public static string DataDir
    {
        get
        {
            var d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LontraxAddons");
            Directory.CreateDirectory(d);
            return d;
        }
    }
}
