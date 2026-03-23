---
description: howtorunactor
---

# Run Actor and retrieve data via API

**Learn how to run an Actor/task via the Apify API, wait for the job to finish, and retrieve its output data. Your key to integrating Actors with your projects.**

***

<!-- -->

The most popular way of [integrating](https://help.apify.com/en/collections/1669769-integrations) the Apify platform with an external project/application is by programmatically running an [Actor](https://docs.apify.com/platform/actors.md) or [task](https://docs.apify.com/platform/actors/running/tasks.md), waiting for it to complete its run, then collecting its data and using it within the project. Follow this tutorial to have an idea on how to approach this, it isn't as complicated as it sounds!

> Remember to check out our [API documentation](https://docs.apify.com/api/v2.md) with examples in different languages and a live API console. We also recommend testing the API with a desktop client like [Postman](https://www.postman.com/) or [Insomnia](https://insomnia.rest).

Apify API offers two ways of interacting with it:

*
*

If the Actor being run via API takes 5 minutes or less to complete a typical run, it should be called **synchronously**. Otherwise, (if a typical run takes longer than 5 minutes), it should be called **asynchronously**.

## Run an Actor or task

> If you are unsure about the differences between an Actor and a task, you can read about them in the [tasks](https://docs.apify.com/platform/actors/running/tasks.md) documentation. In brief, tasks are pre-configured inputs for Actors.

The API endpoints and usage (for both sync and async) for [Actors](https://docs.apify.com/api/v2.md#tag/ActorsRun-collection/operation/act_runs_post) and [tasks](https://docs.apify.com/api/v2/actor-task-runs-post.md) are essentially the same.

To run, or **call**, an Actor/task, you will need a few things:

* The name or ID of the Actor/task. The name looks like `username~actorName` or `username~taskName`. The ID can be retrieved on the **Settings** page of the Actor/task.

* Your [API token](https://docs.apify.com/platform/integrations.md), which you can find on the **Integrations** page in [Apify Console](https://console.apify.com/account?tab=integrations) (do not share it with anyone!).

* Possibly an input, which is passed in JSON format as the request's **body**.

* Some other optional settings if you'd like to change the default values (such as allocated memory or the build).

The URL of [POST request](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/POST) to run an Actor looks like this:


```
https://api.apify.com/v2/acts/ACTOR_NAME_OR_ID/runs?token=YOUR_TOKEN
```


For tasks, we can switch the path from **acts** to **actor-tasks** and keep the rest the same:


```
https://api.apify.com/v2/actor-tasks/TASK_NAME_OR_ID/runs?token=YOUR_TOKEN
```


If we send a correct POST request to one of these endpoints, the actor/actor-task will start just as if we had pressed the **Start** button on the Actor's page in the [Apify Console](https://console.apify.com).

### Additional settings

We can also add settings for the Actor (which will override the default settings) as additional query parameters. For example, if we wanted to change how much memory the Actor's run should be allocated and which build to run, we could add the `memory` and `build` parameters separated by `&`.


```
https://api.apify.com/v2/acts/ACTOR_NAME_OR_ID/runs?token=YOUR_TOKEN&memory=8192&build=beta
```


This works in almost exactly the same way for both Actors and tasks; however, for tasks, there is no reason to specify a [build](https://docs.apify.com/platform/actors/development/builds-and-runs/builds.md) parameter, as a task already has only one specific Actor build which cannot be changed with query parameters.

### Input JSON

Most Actors would not be much use if input could not be passed into them to change their behavior. Additionally, even though tasks already have specified input configurations, it is handy to have the ability to overwrite task inputs through the **body** of the POST request.

> The input can technically be any [JSON object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON), and will vary depending on the Actor being run. Ensure that you are familiar with the Actor's input schema while writing the body of the request.

Good Actors have reasonable defaults for most input fields, so if you want to run one of the major Actors from [Apify Store](https://apify.com/store), you usually do not need to provide all possible fields.

Via API, let's quickly try to run [Web Scraper](https://apify.com/apify/web-scraper), which is the most popular Actor on Apify Store at the moment. The full input with all possible fields is [pretty long and ugly](https://apify.com/apify/web-scraper?section=example-run), so we will not show it here. Because it has default values for most fields, we can provide a JSON input containing only the fields we'd like to customize. We will send a POST request to the endpoint below and add the JSON as the **body** of the request:


```
https://api.apify.com/v2/acts/apify~web-scraper/runs?token=YOUR_TOKEN
```


Here is how it looks in [Postman](https://www.postman.com/):

![Run an Actor via API in Postman](/assets/images/run-actor-postman-b89097bdd92cf55096e73719086cb847.png)

If we press **Send**, it will immediately return some info about the run. The `status` will be either `READY` (which means that it is waiting to be allocated on a server) or `RUNNING` (99% of cases).

![Actor run info in Postman](/assets/images/run-info-postman-0d11537cf5eeccf8a474cdeab4e8550d.png)

We will later use this **run info** JSON to retrieve the run's output data. This info about the run can also be retrieved with another call to the [Get run](https://docs.apify.com/api/v2/act-run-get.md) endpoint.

## JavaScript and Python client

If you are using JavaScript or Python, we highly recommend using the Apify API client ([JavaScript](https://docs.apify.com/api/client/js/), [Python](https://docs.apify.com/api/client/python/)) instead of the raw HTTP API. The client implements smart polling and exponential backoff, which makes calling Actors and getting results efficient.

You can skip most of this tutorial by following this code example that calls Google Search Results Scraper and logs its results:

* Node.js
* Python


```
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({ token: 'YOUR_API_TOKEN' });

const input = { queries: 'Food in NYC' };

// Run the Actor and wait for it to finish
// .call method waits infinitely long using smart polling
// Get back the run API object
const run = await client.actor('apify/google-search-scraper').call(input);

// Fetch and print Actor results from the run's dataset (if any)
const { items } = await client.dataset(run.defaultDatasetId).listItems();
items.forEach((item) => {
    console.dir(item);
});
```



```
from apify_client import ApifyClient
client = ApifyClient(token='YOUR_API_TOKEN')

run_input = {
    "queries": "Food in NYC",
}

# Run the Actor and wait for it to finish
# .call method waits infinitely long using smart polling
# Get back the run API object
run = client.actor("apify/google-search-scraper").call(run_input=run_input)

# Fetch and print Actor results from the run's dataset (if there are any)
for item in client.dataset(run["defaultDatasetId"]).iterate_items():
    print(item)
```


By using our client, you don't need to worry about choosing between synchronous or asynchronous flow. But if you don't want your code to wait during `.call` (potentially for hours), continue reading below about how to implement webhooks.

## Synchronous flow

If each of your runs will last shorter than 5 minutes, you can use a single [synchronous endpoint](https://usergrid.apache.org/docs/introduction/async-vs-sync.html#synchronous). When running **synchronously**, the connection will be held for *up to* 5 minutes.

If your synchronous run exceeds the 5-minute time limit, the response will be a run object containing information about the run and the status of `RUNNING`. If that happens, you need to restart the run  and .

### Synchronous runs with dataset output

Most Actor runs will store their data in the default [dataset](https://docs.apify.com/platform/storage/dataset.md). The Apify API provides **run-sync-get-dataset-items** endpoints for [Actors](https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post.md) and [tasks](https://docs.apify.com/api/v2/actor-task-run-sync-get-dataset-items-post.md), which allow you to run an Actor and receive the items from the default dataset once the run has finished.

Here is a Node.js example of calling a task via the API and logging the dataset items to the console:


```
// Use your favorite HTTP client
import got from 'got';

// Specify your API token
// (find it at https://console.apify.com/account#/integrations)
const myToken = '<YOUR_APIFY_TOKEN>';

// Start apify/google-search-scraper Actor
// and pass some queries into the JSON body
const response = await got({
    url: `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${myToken}`,
    method: 'POST',
    json: {
        queries: 'web scraping\nweb crawling',
    },
    responseType: 'json',
});

const items = response.body;

// Log each non-promoted search result for both queries
items.forEach((item) => {
    const { nonPromotedSearchResults } = item;
    nonPromotedSearchResults.forEach((result) => {
        const { title, url, description } = result;
        console.log(`${title}: ${url} --- ${description}`);
    });
});
```


### Synchronous runs with key-value store output

[Key-value stores](https://docs.apify.com/platform/storage/key-value-store.md) are useful for storing files like images, HTML snapshots, or JSON data. The Apify API provides **run-sync** endpoints for [Actors](https://docs.apify.com/api/v2/act-run-sync-post.md) and [tasks](https://docs.apify.com/api/v2/actor-task-run-sync-post.md), which allow you to run a specific task and receive the output. By default, they return the `OUTPUT` record from the default key-value store.

## Asynchronous flow

For runs longer than 5 minutes, the process consists of three steps:

*
*
*

### Wait for the run to finish

There may be cases where we need to run the Actor and go away. But in any kind of integration, we are usually interested in its output. We have three basic options for how to wait for the actor/task to finish.

*
*
*

#### `waitForFinish` parameter

This solution is quite similar to the synchronous flow. To make the POST request wait, add the `waitForFinish` parameter. It can have a value from `0` to `60`, which is the maximum time in seconds to wait (the max value for `waitForFinish` is 1 minute). Knowing this, we can extend the example URL like this:


```
https://api.apify.com/v2/acts/apify~web-scraper/runs?token=YOUR_TOKEN&waitForFinish=60
```


You can also use the `waitForFinish` parameter with the [GET Run endpoint](https://docs.apify.com/api/v2/actor-run-get.md) to implement a smarter  system.

Once again, the final response will be the **run info object**; however, now its status should be `SUCCEEDED` or `FAILED`. If the run exceeds the `waitForFinish` duration, the status will still be `RUNNING`.

#### Webhooks

If you have a server, [webhooks](https://docs.apify.com/platform/integrations/webhooks.md) are the most elegant and flexible solution for integrations with Apify. You can set up a webhook for any Actor or task, and that webhook will send a POST request to your server after an [event](https://docs.apify.com/platform/integrations/webhooks/events.md) has occurred.

Usually, this event is a successfully finished run, but you can also set a different webhook for failed runs, etc.

![Webhook example](/assets/images/webhook-8b2fcb569631f00cd1bcc8a6db263572.png)

