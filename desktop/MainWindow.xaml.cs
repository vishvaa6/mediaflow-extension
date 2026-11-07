using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Input;
using Microsoft.Web.WebView2.Core;
using Windows.System;

namespace MediaFlow_Desktop;

public sealed partial class MainWindow : Window
{
    private bool ready;

    public MainWindow()
    {
        InitializeComponent();
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1440, 900));
        InitializeBrowser();
    }

    private async void InitializeBrowser()
    {
        try
        {
            string extensionPath = Path.Combine(AppContext.BaseDirectory, "Extension");
            if (!File.Exists(Path.Combine(extensionPath, "manifest.json")))
                throw new FileNotFoundException("The bundled extension folder is missing.", extensionPath);
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MediaFlowDesktop", "WebView2");
            var options = new CoreWebView2EnvironmentOptions { AreBrowserExtensionsEnabled = true };
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null, profile, options);
            await Browser.EnsureCoreWebView2Async(environment);
            var extension = await Browser.CoreWebView2.Profile.AddBrowserExtensionAsync(extensionPath);
            await Workspace.EnsureCoreWebView2Async(environment);
            Browser.CoreWebView2.SourceChanged += (_, _) => AddressBox.Text = Browser.CoreWebView2.Source;
            Browser.CoreWebView2.NewWindowRequested += (_, args) => { args.Handled = true; Browser.CoreWebView2.Navigate(args.Uri); };
            Browser.CoreWebView2.NavigationCompleted += (_, args) => StatusText.Text = args.IsSuccess ? "Ready" : $"Page could not load: {args.WebErrorStatus}";
            Workspace.CoreWebView2.NavigationCompleted += (_, args) => { if (!args.IsSuccess) StatusText.Text = $"MediaFlow workspace could not load: {args.WebErrorStatus}"; };
            Workspace.CoreWebView2.Navigate($"chrome-extension://{extension.Id}/src/pages/popup/index.html?surface=tab");
            Browser.CoreWebView2.Navigate("https://www.google.com/");
            ready = true;
            StatusText.Text = "Ready — open a video page in the browser.";
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Could not start MediaFlow: {ex.Message}";
        }
    }

    private void Navigate()
    {
        if (!ready) return;
        string input = AddressBox.Text.Trim();
        if (!input.Contains("://")) input = "https://" + input;
        if (Uri.TryCreate(input, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            Browser.CoreWebView2.Navigate(uri.ToString());
        else StatusText.Text = "Enter a valid HTTP or HTTPS address.";
    }
    private void Go_Click(object sender, RoutedEventArgs e) => Navigate();
    private void Address_KeyDown(object sender, KeyRoutedEventArgs e) { if (e.Key == VirtualKey.Enter) Navigate(); }
    private void Back_Click(object sender, RoutedEventArgs e) { if (ready && Browser.CoreWebView2.CanGoBack) Browser.CoreWebView2.GoBack(); }
    private void Forward_Click(object sender, RoutedEventArgs e) { if (ready && Browser.CoreWebView2.CanGoForward) Browser.CoreWebView2.GoForward(); }
    private void Reload_Click(object sender, RoutedEventArgs e) { if (ready) Browser.CoreWebView2.Reload(); }
}

